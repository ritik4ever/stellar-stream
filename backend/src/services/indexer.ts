import {
  Contract,
  rpc,
  TransactionBuilder,
  Networks,
  scValToNative,
} from "@stellar/stellar-sdk";
import { recordEventWithDb } from "./eventHistory";
import { getDb } from "./db";
import {
  eventsIndexedTotal,
  ledgersScannedTotal,
  lastIndexedLedger,
  indexerErrorsTotal,
  indexerCircuitState,
} from "./metrics";
import { logger } from "../logger";

const FALLBACK_POLLING_ENABLED = process.env.INDEXER_FALLBACK_POLLING_ENABLED === "true";
const FALLBACK_POLL_INTERVAL_MS = Number(process.env.INDEXER_FALLBACK_POLL_INTERVAL_MS ?? 10000);

let rpcServer: rpc.Server | null = null;
let contractId: string | null = null;
let networkPassphrase: string = Networks.TESTNET;
let lastProcessedLedger = 0;
let indexerInterval: NodeJS.Timeout | null = null;
let indexerStartLedger: number | null = null;
let isIndexing = false;

const INDEXER_CURSOR_TABLE = "indexer_cursor";
const CHECKPOINT_ROW_ID = 1;

export enum CircuitState {
  CLOSED = "CLOSED",
  OPEN = "OPEN",
  HALF_OPEN = "HALF_OPEN",
}

export class CircuitBreaker {
  private state: CircuitState = CircuitState.CLOSED;
  private failureCount: number = 0;
  private lastFailureTime: number = 0;
  private readonly failureThreshold: number = 5;
  private readonly timeoutMs: number;

  constructor(timeoutMs: number = 60000) {
    this.timeoutMs = timeoutMs;
  }

  public getState(): CircuitState {
    if (this.state === CircuitState.OPEN) {
      const now = Date.now();
      if (now - this.lastFailureTime >= this.timeoutMs) {
        this.setState(CircuitState.HALF_OPEN);
      }
    }
    return this.state;
  }

  public onSuccess(): void {
    if (this.state !== CircuitState.CLOSED) {
      logger.info("circuit breaker probe succeeded");
      this.setState(CircuitState.CLOSED);
    }
    this.failureCount = 0;
  }

  public onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.state === CircuitState.CLOSED && this.failureCount >= this.failureThreshold) {
      logger.warn({ failureThreshold: this.failureThreshold }, "circuit breaker failure threshold reached");
      this.setState(CircuitState.OPEN);
    } else if (this.state === CircuitState.HALF_OPEN) {
      logger.warn("circuit breaker probe failed");
      this.setState(CircuitState.OPEN);
    }
  }

  /** Resets the circuit breaker to CLOSED with zero failures. Intended for tests. */
  public reset(): void {
    this.failureCount = 0;
    this.lastFailureTime = 0;
    this.setState(CircuitState.CLOSED);
  }

  private setState(newState: CircuitState): void {
    if (this.state !== newState) {
      logger.info({ from: this.state, to: newState }, "circuit breaker state changed");
      this.state = newState;
    }
    const stateValue =
      newState === CircuitState.CLOSED ? 0
      : newState === CircuitState.HALF_OPEN ? 1
      : 2;
    indexerCircuitState.set(stateValue);
  }
}

const CIRCUIT_BREAKER_TIMEOUT_MS = Number(process.env.CIRCUIT_BREAKER_TIMEOUT_MS ?? 60000);
const circuitBreaker = new CircuitBreaker(CIRCUIT_BREAKER_TIMEOUT_MS);

export function getCircuitBreakerStatus(): CircuitState {
  return circuitBreaker.getState();
}

function isFallbackPollingEnabled(): boolean {
  return FALLBACK_POLLING_ENABLED;
}

function getFallbackPollInterval(): number {
  return Math.max(1000, FALLBACK_POLL_INTERVAL_MS);
}

function loadCheckpoint(db: any): void {
  try {
    const row = db
      .prepare(`SELECT last_ledger_sequence FROM ${INDEXER_CURSOR_TABLE} WHERE id = @id`)
      .get({ id: CHECKPOINT_ROW_ID }) as { last_ledger_sequence: number } | undefined;

    if (row && row.last_ledger_sequence > 0) {
      lastProcessedLedger = row.last_ledger_sequence;
      logger.info({ lastProcessedLedger }, "loaded indexer checkpoint from database");
    } else {
      logger.info("no checkpoint found, starting from ledger 0");
    }
  } catch (err) {
    logger.error({ err }, "failed to load indexer checkpoint, starting from ledger 0");
    lastProcessedLedger = 0;
  }
}

function saveCheckpoint(db: any, ledgerSequence: number): void {
  try {
    db.transaction(() => {
      const existing = db
        .prepare(`SELECT id FROM ${INDEXER_CURSOR_TABLE} WHERE id = @id`)
        .get({ id: CHECKPOINT_ROW_ID }) as { id: number } | undefined;

      if (existing) {
        db.prepare(
          `UPDATE ${INDEXER_CURSOR_TABLE} SET last_ledger_sequence = @ledger WHERE id = @id`,
        ).run({ ledger: ledgerSequence, id: CHECKPOINT_ROW_ID });
      } else {
        db.prepare(
          `INSERT INTO ${INDEXER_CURSOR_TABLE} (id, last_ledger_sequence) VALUES (@id, @ledger)`,
        ).run({ id: CHECKPOINT_ROW_ID, ledger: ledgerSequence });
      }
    })();
    logger.debug({ ledgerSequence }, "checkpoint saved to database");
  } catch (err) {
    logger.error({ err }, "failed to save indexer checkpoint");
  }
}

export function initIndexer(
  rpcUrl: string,
  contractIdParam: string,
  networkPass?: string,
): void {
  rpcServer = new rpc.Server(rpcUrl);
  contractId = contractIdParam;
  if (networkPass) {
    networkPassphrase = networkPass;
  }

  const startLedgerEnv = process.env.INDEXER_START_LEDGER;
  if (startLedgerEnv !== undefined) {
    const startLedger = parseInt(startLedgerEnv, 10);
    if (!isNaN(startLedger)) {
      indexerStartLedger = startLedger;
      if (startLedger !== 0) {
        logger.warn({ startLedger }, "INDEXER_START_LEDGER override active");
      }
    } else {
      logger.error({ value: startLedgerEnv }, "invalid INDEXER_START_LEDGER value");
    }
  }

  const db = getDb();
  ensureIndexerCursorTable(db);
  loadCheckpoint(db);

  if (indexerStartLedger !== null && indexerStartLedger > lastProcessedLedger) {
    lastProcessedLedger = indexerStartLedger;
    logger.info({ lastProcessedLedger }, "applied INDEXER_START_LEDGER override to checkpoint");
  }
}

function ensureIndexerCursorTable(db: any): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS ${INDEXER_CURSOR_TABLE} (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      last_ledger_sequence INTEGER NOT NULL
    );
  `);
}

export function startIndexer(intervalMs = 10000): void {
  if (indexerInterval) {
    return;
  }

  const effectiveInterval = isFallbackPollingEnabled()
    ? getFallbackPollInterval()
    : intervalMs;

  logger.info(
    { intervalMs: effectiveInterval, fallbackMode: isFallbackPollingEnabled() },
    "event indexer started",
  );

  indexerInterval = setInterval(() => {
    indexEvents().catch((err) => {
      logger.error({ err }, "indexer error");
    });
  }, effectiveInterval);

  indexEvents().catch((err) => {
    logger.error({ err }, "initial indexer error");
  });
}

export function stopIndexer(): void {
  if (indexerInterval) {
    clearInterval(indexerInterval);
    indexerInterval = null;
    logger.info("event indexer stopped");
  }
}

/**
 * Resets all module-level indexer state.
 * Intended for use in tests only — allows each test to start with a clean slate
 * without module-cache pollution from a previous `initIndexer` call.
 * @internal
 */
export function resetIndexerState(): void {
  rpcServer = null;
  contractId = null;
  networkPassphrase = Networks.TESTNET;
  lastProcessedLedger = 0;
  indexerInterval = null;
  indexerStartLedger = null;
  circuitBreaker.reset();
}

async function indexEvents(): Promise<void> {
  if (!rpcServer || !contractId) {
    return;
  }

  if (isIndexing) {
    return;
  }

  const state = circuitBreaker.getState();
  if (state === CircuitState.OPEN) {
    return;
  }

  isIndexing = true;

  try {
    const db = getDb();
    const latestLedger = await rpcServer.getLatestLedger();
    const currentLedger = latestLedger.sequence;

    if (currentLedger <= lastProcessedLedger) {
      circuitBreaker.onSuccess();
      return;
    }

    if (isFallbackPollingEnabled()) {
      await indexEventsWithFallback(db, currentLedger);
    } else {
      await indexEventsWithCursorPagination(db, currentLedger);
    }

    circuitBreaker.onSuccess();
  } catch (err) {
    circuitBreaker.onFailure();
    indexerErrorsTotal.inc();
    logger.error({ err }, "failed to index events");
  } finally {
    isIndexing = false;
  }
}

async function indexEventsWithFallback(db: any, currentLedger: number): Promise<void> {
  const startLedger = lastProcessedLedger + 1;
  let events;

  try {
    events = await rpcServer.getEvents({
      startLedger,
      filters: [
        {
          type: "contract",
          contractIds: [contractId!],
        },
      ],
    });
  } catch (err) {
    logger.error({ err }, "RPC getEvents failed in fallback mode");
    throw err;
  }

  const startLedgerForMetrics = lastProcessedLedger;
  const eventCount = events.events?.length ?? 0;

  if (eventCount === 0) {
    return;
  }

  db.transaction(() => {
    for (const event of events.events || []) {
      processEvent(db, event);
      eventsIndexedTotal.inc();
    }

    lastProcessedLedger = currentLedger;
  })();

  saveCheckpoint(db, lastProcessedLedger);
  ledgersScannedTotal.inc(lastProcessedLedger - startLedgerForMetrics);
}

async function indexEventsWithCursorPagination(db: any, currentLedger: number): Promise<void> {
  const startLedger = lastProcessedLedger + 1;
  let cursor: string | undefined;
  let maxLedgerSeen = lastProcessedLedger;
  let totalProcessed = 0;
  const startLedgerForMetrics = lastProcessedLedger;

  while (true) {
    let request: rpc.Api.GetEventsRequest;

    if (cursor === undefined) {
      request = {
        startLedger,
        filters: [
          {
            type: "contract",
            contractIds: [contractId!],
          },
        ],
      };
    } else {
      request = {
        cursor,
        filters: [
          {
            type: "contract",
            contractIds: [contractId!],
          },
        ],
      };
    }

    let eventsResponse: rpc.Api.GetEventsResponse;

    try {
      eventsResponse = await rpcServer.getEvents(request);
    } catch (err) {
      logger.error({ err }, "RPC getEvents failed during cursor pagination");
      throw err;
    }

    const events = eventsResponse.events ?? [];

    if (events.length === 0) {
      break;
    }

    db.transaction(() => {
      for (const event of events) {
        processEvent(db, event);
        eventsIndexedTotal.inc();
        totalProcessed++;

        if (event.ledger > maxLedgerSeen) {
          maxLedgerSeen = event.ledger;
        }
      }
    })();

    cursor = eventsResponse.cursor;

    if (!cursor) {
      break;
    }
  }

  if (totalProcessed > 0) {
    lastProcessedLedger = Math.max(lastProcessedLedger, maxLedgerSeen);
    saveCheckpoint(db, lastProcessedLedger);
    ledgersScannedTotal.inc(lastProcessedLedger - startLedgerForMetrics);
  }
}

function processEvent(db: any, event: rpc.Api.EventResponse): void {
  try {
    const topic = event.topic.map((t: any) => scValToNative(t));
    const value = scValToNative(event.value);

    if (topic.length < 2) return;

    const eventName = topic[1];
    const timestamp = Math.floor(new Date(event.ledgerClosedAt).getTime() / 1000);

    switch (eventName) {
      case "Created":
        recordEventWithDb(
          db,
          value.stream_id.toString(),
          "created",
          timestamp,
          // actor == sender for Created events
          value.actor ?? value.sender,
          value.total_amount,
          {
            recipient: value.recipient,
            token: value.token,
            startTime: value.start_time,
            endTime: value.end_time,
          },
          event.ledger,
        );
        break;

      case "Claimed":
        recordEventWithDb(
          db,
          value.stream_id.toString(),
          "claimed",
          timestamp,
          // actor == recipient for Claimed events
          value.actor ?? value.recipient,
          value.amount,
          { claimed_amount: value.claimed_amount },
          event.ledger,
        );
        break;

      case "Completed":
        recordEventWithDb(
          db,
          value.stream_id.toString(),
          "completed",
          timestamp,
          value.actor,
          value.total_amount,
          undefined,
          event.ledger,
        );
        break;

      case "Canceled":
        recordEventWithDb(
          db,
          value.stream_id.toString(),
          "canceled",
          timestamp,
          // actor == sender for Canceled events
          value.actor ?? value.sender,
          value.refunded_amount,
          undefined,
          event.ledger,
        );
        break;

      case "Paused":
        recordEventWithDb(
          db,
          value.stream_id.toString(),
          "paused",
          timestamp,
          // actor == sender for Paused events
          value.actor ?? value.sender,
          undefined,
          { paused_at: value.paused_at },
          event.ledger,
        );
        break;

      case "Resumed":
        recordEventWithDb(
          db,
          value.stream_id.toString(),
          "resumed",
          timestamp,
          // actor == sender for Resumed events
          value.actor ?? value.sender,
          undefined,
          { resumed_at: value.resumed_at },
          event.ledger,
        );
        break;

      case "Transfer":
        recordEventWithDb(
          db,
          value.stream_id.toString(),
          "transferred",
          timestamp,
          // actor == old_recipient (the one who authorized the transfer)
          value.actor ?? value.old_recipient,
          undefined,
          { new_recipient: value.new_recipient },
          event.ledger,
        );
        break;

      case "Clawback":
        recordEventWithDb(
          db,
          value.stream_id.toString(),
          "clawback",
          timestamp,
          // actor == admin address
          value.actor,
          value.amount,
          { recipient: value.recipient },
          event.ledger,
        );
        break;

      default:
        logger.warn({ eventName }, "unknown contract event type — skipped");
        break;
    }
  } catch (err) {
    logger.error({ err }, "failed to process event");
  }
}