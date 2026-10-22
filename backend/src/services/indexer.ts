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
  indexerLatestLedger,
  indexerLedgerLag,
  indexerErrorsTotal,
  indexerCircuitState,
  indexerEventsDedupedTotal,
  indexerPollDurationMs,
  type IndexerPollOutcome,
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
let lastObservedLedger: number | null = null;
let lastFailureKind: IndexerRpcFailureKind | null = null;
let lastPollOutcome: IndexerPollOutcome | null = null;
let lastPollDurationMs: number | null = null;
/** Monotonically incrementing poll cycle counter — used as a lightweight request ID for log correlation. */
let pollCycleId = 0;

const INDEXER_CURSOR_TABLE = "indexer_cursor";
const CHECKPOINT_ROW_ID = 1;

/**
 * Enumerated reason the most recent indexer poll failed.
 *
 * Raw provider errors are mapped to these coarse kinds so the monitoring
 * outcome signal never has to carry an error message (which can embed an RPC
 * URL, credential, or contract ID).
 */
export type IndexerRpcFailureKind =
  | "rate_limited"
  | "disconnected"
  | "provider_error"
  | "unknown";

function extractStatusCode(err: unknown): number | undefined {
  if (err && typeof err === "object") {
    const e = err as Record<string, any>;
    const raw = e["status"] ?? e["statusCode"] ?? e["response"]?.["status"];
    return typeof raw === "number" ? raw : undefined;
  }
  return undefined;
}

function errorHaystack(err: unknown): string {
  if (!err || typeof err !== "object") {
    return String(err ?? "").toLowerCase();
  }
  const e = err as Record<string, any>;
  return [e["message"], e["code"], e["name"]]
    .filter((part) => part !== undefined && part !== null)
    .map((part) => String(part))
    .join(" ")
    .toLowerCase();
}

/**
 * Classifies an RPC failure into the coarse kinds surfaced by the indexer
 * monitoring outcome. Deliberately returns a kind, never the original message,
 * so callers cannot leak provider URLs or credentials by accident.
 */
export function classifyRpcFailure(err: unknown): IndexerRpcFailureKind {
  const statusCode = extractStatusCode(err);
  const text = errorHaystack(err);

  if (
    statusCode === 429 ||
    text.includes("429") ||
    text.includes("rate limit") ||
    text.includes("too many requests") ||
    text.includes("throttl")
  ) {
    return "rate_limited";
  }

  if (
    statusCode === 503 ||
    statusCode === 504 ||
    text.includes("503") ||
    text.includes("504") ||
    text.includes("service unavailable") ||
    text.includes("gateway timeout") ||
    text.includes("econnrefused") ||
    text.includes("econnreset") ||
    text.includes("etimedout") ||
    text.includes("epipe") ||
    text.includes("socket hang up") ||
    text.includes("disconnect") ||
    text.includes("network") ||
    text.includes("timeout") ||
    text.includes("fetch failed")
  ) {
    return "disconnected";
  }

  return statusCode === undefined ? "unknown" : "provider_error";
}


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

  /** Consecutive failures recorded since the last successful poll. */
  public getFailureCount(): number {
    return this.failureCount;
  }

  /** Number of consecutive failures that opens the circuit. */
  public getFailureThreshold(): number {
    return this.failureThreshold;
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

/**
 * Secret-free view of the indexer's progress and RPC health, consumed by the
 * monitoring outcome signal in `indexerMonitor.ts`. Carries ledgers, counts and
 * enumerated state only — never the RPC URL, contract ID, or credentials.
 */
export interface IndexerMonitoringSnapshot {
  /** Whether an RPC endpoint and contract are configured. */
  rpcConfigured: boolean;
  /** Highest ledger observed from RPC, or null if no poll has succeeded yet. */
  latestLedger: number | null;
  /** Persisted checkpoint (last fully processed ledger). */
  indexedLedger: number;
  /** Unprocessed ledger backlog, clamped at zero. */
  ledgerLag: number;
  /** Consecutive failed polls since the last success. */
  consecutiveFailures: number;
  /** Consecutive failures that open the circuit. */
  failureThreshold: number;
  /** Current circuit breaker state. */
  circuitState: CircuitState;
  /** Coarse kind of the last poll failure, or null after a success. */
  lastFailureKind: IndexerRpcFailureKind | null;
  /** Whether a poll is currently in flight. */
  pollInFlight: boolean;
  /**
   * Coarse outcome of the most recently completed poll cycle, or null if no
   * poll has completed yet. Allows operators to distinguish a normal idle state
   * (`normal_empty`) from a restart-recovery dedup cycle (`restart_recovery`),
   * an empty ledger range (`empty_range`), and successful event processing
   * (`events_processed`).
   */
  lastPollOutcome?: IndexerPollOutcome | null;
  /**
   * Wall-clock duration of the most recently completed poll cycle in
   * milliseconds. Null before the first poll completes.
   */
  lastPollDurationMs?: number | null;
  /**
   * Monotonically incrementing ID for the current (or most recently completed)
   * poll cycle. Use this to correlate log lines emitted during a single cycle.
   * Zero before the first poll starts.
   */
  pollCycleId?: number;
}

export function getIndexerMonitoringSnapshot(): IndexerMonitoringSnapshot {
  const latestLedger = lastObservedLedger;
  return {
    rpcConfigured: Boolean(rpcServer && contractId),
    latestLedger,
    indexedLedger: lastProcessedLedger,
    ledgerLag:
      latestLedger === null
        ? 0
        : Math.max(0, latestLedger - lastProcessedLedger),
    consecutiveFailures: circuitBreaker.getFailureCount(),
    failureThreshold: circuitBreaker.getFailureThreshold(),
    circuitState: circuitBreaker.getState(),
    lastFailureKind,
    pollInFlight: isIndexing,
    lastPollOutcome,
    lastPollDurationMs,
    pollCycleId,
  };
}

/** Records a successful poll: clears the failure budget and the failure kind. */
function recordPollSuccess(): void {
  circuitBreaker.onSuccess();
  lastFailureKind = null;
}

function isFallbackPollingEnabled(): boolean {
  return FALLBACK_POLLING_ENABLED;
}

function getFallbackPollInterval(): number {
  return Math.max(1000, FALLBACK_POLL_INTERVAL_MS);
}

/**
 * Indexer backfill consistency rule
 * --------------------------------
 * The `indexer_cursor.last_ledger_sequence` row is the persisted high-water
 * mark of ledgers that have been fully processed and whose events are
 * durably stored in `stream_events`.
 *
 * Invariant: on success, the checkpoint advances only to a ledger at or
 * beyond the highest event ledger that was committed in this poll.  On
 * failure (RPC error, partial page, crash), the checkpoint is NOT advanced
 * and retains its previous value, so the next poll resumes from the last
 * fully committed ledger.
 *
 * Because event writes and the checkpoint write are separate operations
 * (events are committed page-by-page; the checkpoint is saved after the
 * poll completes), a crash between them can leave events persisted ahead
 * of the checkpoint. That is safe: the dedup index on
 * stream_events(stream_id, event_type, ledger_sequence) makes reprocessing
 * idempotent, and the next poll re-reads from the stale checkpoint. Event
 * decoding or storage errors must escape the page transaction so it rolls
 * back and the checkpoint remains unchanged.
 *
 * Callers must not report a poll as successful unless the checkpoint
 * reflects the events actually committed.  `saveCheckpoint` is only
 * reached after all pages have been processed without error.
 */

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
  } else {
    indexerStartLedger = null;
  }

  const db = getDb();
  ensureIndexerCursorTable(db);
  loadCheckpoint(db);

  if (indexerStartLedger !== null && indexerStartLedger > 0) {
    lastProcessedLedger = Math.max(0, indexerStartLedger - 1);
    logger.info({ lastProcessedLedger: indexerStartLedger }, "applied INDEXER_START_LEDGER override to checkpoint");
  }

  lastIndexedLedger.set(lastProcessedLedger);
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
  lastObservedLedger = null;
  lastFailureKind = null;
  lastPollOutcome = null;
  lastPollDurationMs = null;
  pollCycleId = 0;
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
  const currentPollCycleId = ++pollCycleId;
  const pollStartMs = Date.now();

  try {
    const db = getDb();
    const latestLedger = await rpcServer.getLatestLedger();
    const currentLedger = latestLedger.sequence;
    lastObservedLedger = currentLedger;
    indexerLatestLedger.set(currentLedger);
    indexerLedgerLag.set(Math.max(0, currentLedger - lastProcessedLedger));

    if (currentLedger <= lastProcessedLedger) {
      const durationMs = Date.now() - pollStartMs;
      lastPollOutcome = "normal_empty";
      lastPollDurationMs = durationMs;
      indexerPollDurationMs.set(durationMs);
      logger.debug(
        {
          pollCycleId: currentPollCycleId,
          pollOutcome: "normal_empty",
          pollDurationMs: durationMs,
          indexedLedger: lastProcessedLedger,
          latestLedger: currentLedger,
        },
        "indexer poll: no new ledgers (normal empty)",
      );
      recordPollSuccess();
      return;
    }

    // Detect restart-recovery scenario: the checkpoint cursor lags behind
    // rows already present in stream_events (crash between row insert and
    // cursor write). We probe by counting rows with ledger_sequence >
    // lastProcessedLedger. A non-zero count means this poll will re-fetch
    // events that are already in the DB — they will be silently deduped by
    // INSERT OR IGNORE, but we log and count the dedup activity so operators
    // can distinguish this from a normal empty or fresh poll.
    let isRestartRecovery = false;
    try {
      const aheadRow = db
        .prepare(
          "SELECT COUNT(*) AS cnt FROM stream_events WHERE ledger_sequence > ?",
        )
        .get(lastProcessedLedger) as { cnt: number } | undefined;
      if (aheadRow && aheadRow.cnt > 0) {
        isRestartRecovery = true;
        logger.info(
          {
            pollCycleId: currentPollCycleId,
            existingRowsAheadOfCursor: aheadRow.cnt,
            cursorLedger: lastProcessedLedger,
            currentLedger,
          },
          "indexer restart-recovery: rows exist ahead of the persisted cursor — events will be re-fetched and deduped by INSERT OR IGNORE",
        );
      }
    } catch {
      // Non-fatal: if the probe query fails (e.g. table not yet created in
      // tests), proceed normally without the recovery signal.
    }

    if (isFallbackPollingEnabled()) {
      await indexEventsWithFallback(db, currentLedger, currentPollCycleId, isRestartRecovery);
    } else {
      await indexEventsWithCursorPagination(db, currentLedger, currentPollCycleId, isRestartRecovery);
    }

    recordPollSuccess();
  } catch (err) {
    const durationMs = Date.now() - pollStartMs;
    lastPollOutcome = "rpc_error";
    lastPollDurationMs = durationMs;
    indexerPollDurationMs.set(durationMs);
    circuitBreaker.onFailure();
    lastFailureKind = classifyRpcFailure(err);
    indexerErrorsTotal.inc();
    logger.error(
      {
        pollCycleId: currentPollCycleId,
        pollOutcome: "rpc_error",
        pollDurationMs: durationMs,
        failureKind: lastFailureKind,
      },
      "failed to index events",
    );
  } finally {
    isIndexing = false;
  }
}

async function indexEventsWithFallback(db: any, currentLedger: number, currentPollCycleId: number, isRestartRecovery: boolean): Promise<void> {
  const startLedger = lastProcessedLedger + 1;
  const pollStartMs = Date.now();
  let events;

  try {
    events = await rpcServer!.getEvents({
      startLedger,
      filters: [
        {
          type: "contract",
          contractIds: [contractId!],
        },
      ],
    });
  } catch (err) {
    logger.error(
      { pollCycleId: currentPollCycleId, err },
      "RPC getEvents failed in fallback mode",
    );
    throw err;
  }

  const startLedgerForMetrics = lastProcessedLedger;
  const eventCount = events.events?.length ?? 0;
  let insertedCount = 0;
  let dedupedCount = 0;

  if (eventCount > 0) {
    db.transaction(() => {
      for (const event of events.events || []) {
        const changesBefore = db.prepare("SELECT changes() AS n").get() as { n: number } | undefined;
        processEvent(db, event);
        // `changes()` returns the number of rows modified by the most recent
        // statement. A value of 0 after INSERT OR IGNORE means the row was
        // already present (dedup hit).
        const changesAfter = db.prepare("SELECT changes() AS n").get() as { n: number } | undefined;
        if ((changesAfter?.n ?? 1) === 0) {
          dedupedCount++;
        } else {
          insertedCount++;
        }
      }
    })();
  }

  for (let i = 0; i < insertedCount; i++) {
    eventsIndexedTotal.inc();
  }
  for (let i = 0; i < dedupedCount; i++) {
    indexerEventsDedupedTotal.inc();
  }

  saveCheckpoint(db, currentLedger);
  lastProcessedLedger = currentLedger;
  lastIndexedLedger.set(lastProcessedLedger);
  indexerLedgerLag.set(Math.max(0, currentLedger - lastProcessedLedger));
  ledgersScannedTotal.inc(lastProcessedLedger - startLedgerForMetrics);

  const durationMs = Date.now() - pollStartMs;
  const outcome: IndexerPollOutcome =
    isRestartRecovery
      ? "restart_recovery"
      : insertedCount > 0
        ? "events_processed"
        : "empty_range";
  lastPollOutcome = outcome;
  lastPollDurationMs = durationMs;
  indexerPollDurationMs.set(durationMs);

  logger.info(
    {
      pollCycleId: currentPollCycleId,
      pollOutcome: outcome,
      pollDurationMs: durationMs,
      startLedger,
      currentLedger,
      eventsInserted: insertedCount,
      eventsDeduped: dedupedCount,
      isRestartRecovery,
    },
    "indexer poll completed (fallback mode)",
  );
}

async function indexEventsWithCursorPagination(db: any, currentLedger: number, currentPollCycleId: number, isRestartRecovery: boolean): Promise<void> {
  const startLedger = lastProcessedLedger + 1;
  const pollStartMs = Date.now();
  let cursor: string | undefined;
  let maxLedgerSeen = lastProcessedLedger;
  const startLedgerForMetrics = lastProcessedLedger;
  let totalInserted = 0;
  let totalDeduped = 0;

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
      eventsResponse = await rpcServer!.getEvents(request);
    } catch (err) {
      logger.error(
        { pollCycleId: currentPollCycleId, cursor, err },
        "RPC getEvents failed during cursor pagination",
      );
      throw err;
    }

    const events = eventsResponse.events ?? [];
    const nextCursor = eventsResponse.cursor;
    if (nextCursor && nextCursor === cursor) {
  throw new Error("indexer: RPC returned the same cursor again (replayed page)");
}

    if (events.length === 0) {
      if (!nextCursor) {
        break;
      }

      logger.warn(
        { pollCycleId: currentPollCycleId, cursor, nextCursor },
        "RPC returned an empty page while pagination was still active; retrying with the remaining cursor",
      );
      cursor = nextCursor;
      continue;
    }

    let pageInserted = 0;
    let pageDeduped = 0;

    db.transaction(() => {
      for (const event of events) {
        processEvent(db, event);
        // Detect whether the row was actually inserted or silently skipped.
        // `changes()` returns 0 when INSERT OR IGNORE finds a conflict.
        const changes = db.prepare("SELECT changes() AS n").get() as { n: number } | undefined;
        if ((changes?.n ?? 1) === 0) {
          pageDeduped++;
        } else {
          pageInserted++;
        }

        if (event.ledger > maxLedgerSeen) {
          maxLedgerSeen = event.ledger;
        }
      }
    })();

    for (let i = 0; i < pageInserted; i++) {
      eventsIndexedTotal.inc();
    }
    for (let i = 0; i < pageDeduped; i++) {
      indexerEventsDedupedTotal.inc();
    }

    totalInserted += pageInserted;
    totalDeduped += pageDeduped;

    if (pageDeduped > 0) {
      logger.info(
        {
          pollCycleId: currentPollCycleId,
          cursor,
          pageEventsTotal: events.length,
          pageInserted,
          pageDeduped,
          isRestartRecovery,
        },
        "indexer page: duplicate events silently skipped by INSERT OR IGNORE",
      );
    }

    cursor = nextCursor;

    if (!cursor) {
      break;
    }
  }

  const checkpoint = Math.max(currentLedger, maxLedgerSeen);
  saveCheckpoint(db, checkpoint);
  lastProcessedLedger = checkpoint;
  lastIndexedLedger.set(lastProcessedLedger);
  indexerLedgerLag.set(Math.max(0, currentLedger - lastProcessedLedger));
  ledgersScannedTotal.inc(lastProcessedLedger - startLedgerForMetrics);

  const durationMs = Date.now() - pollStartMs;
  const outcome: IndexerPollOutcome =
    isRestartRecovery
      ? "restart_recovery"
      : totalInserted > 0
        ? "events_processed"
        : "empty_range";
  lastPollOutcome = outcome;
  lastPollDurationMs = durationMs;
  indexerPollDurationMs.set(durationMs);

  logger.info(
    {
      pollCycleId: currentPollCycleId,
      pollOutcome: outcome,
      pollDurationMs: durationMs,
      startLedger,
      currentLedger,
      checkpointLedger: checkpoint,
      eventsInserted: totalInserted,
      eventsDeduped: totalDeduped,
      isRestartRecovery,
    },
    "indexer poll completed (cursor pagination)",
  );
}

type ProcessResult = "inserted" | "deduped" | "skipped";

function processEvent(db: any, event: rpc.Api.EventResponse): ProcessResult {
  const topic = event.topic.map((t: any) => scValToNative(t));
  const value = scValToNative(event.value);

  if (topic.length < 2) return "skipped";
  if (topic[0] !== "Stream") return "skipped";

  const eventName = topic[1];
  const timestamp = Math.floor(new Date(event.ledgerClosedAt).getTime() / 1000);
  const streamId = value.stream_id.toString();

  switch (eventName) {
    case "Created":
      return recordEventWithDb(db, streamId, "created", timestamp,
        value.actor ?? value.sender, value.total_amount,
        { recipient: value.recipient, token: value.token, startTime: value.start_time, endTime: value.end_time },
        event.ledger);

    case "Claimed":
      return recordEventWithDb(db, streamId, "claimed", timestamp,
        value.actor ?? value.recipient, value.amount,
        { claimed_amount: value.claimed_amount }, event.ledger);

    case "Completed":
      return recordEventWithDb(db, streamId, "completed", timestamp,
        value.actor, value.total_amount, undefined, event.ledger);

    case "Canceled":
      return recordEventWithDb(db, streamId, "canceled", timestamp,
        value.actor ?? value.sender, value.refunded_amount, undefined, event.ledger);

    case "Paused":
      return recordEventWithDb(db, streamId, "paused", timestamp,
        value.actor ?? value.sender, undefined,
        { paused_at: value.paused_at }, event.ledger);

    case "Resumed":
      return recordEventWithDb(db, streamId, "resumed", timestamp,
        value.actor ?? value.sender, undefined,
        { resumed_at: value.resumed_at }, event.ledger);

    case "Transfer":
      return recordEventWithDb(db, streamId, "transferred", timestamp,
        value.actor ?? value.old_recipient, undefined,
        { new_recipient: value.new_recipient }, event.ledger);

    case "Clawback":
      return recordEventWithDb(db, streamId, "clawback", timestamp,
        value.actor, value.amount, { recipient: value.recipient }, event.ledger);

    default:
      logger.warn({ eventName }, "unknown contract event type — skipped");
      return "skipped";
  }
}
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
    throw err;
  }
}
