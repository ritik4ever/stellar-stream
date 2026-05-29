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

let rpcServer: rpc.Server | null = null;
let contractId: string | null = null;
let networkPassphrase: string = Networks.TESTNET;
let lastProcessedLedger = 0;
let indexerInterval: NodeJS.Timeout | null = null;
let indexerStartLedger: number | null = null;

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
      console.log(`[Circuit Breaker] Probe successful. Resetting to CLOSED state.`);
      this.setState(CircuitState.CLOSED);
    }
    this.failureCount = 0;
  }

  public onFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();
    
    if (this.state === CircuitState.CLOSED && this.failureCount >= this.failureThreshold) {
      console.log(`[Circuit Breaker] ${this.failureThreshold} consecutive failures reached. Opening circuit.`);
      this.setState(CircuitState.OPEN);
    } else if (this.state === CircuitState.HALF_OPEN) {
      console.log(`[Circuit Breaker] Probe failed in HALF_OPEN state. Re-opening circuit.`);
      this.setState(CircuitState.OPEN);
    }
  }

  private setState(newState: CircuitState): void {
    if (this.state !== newState) {
      console.log(`[Circuit Breaker] State Transition: ${this.state} -> ${newState}`);
      this.state = newState;
    }
    // Keep gauge in sync whenever state is evaluated
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

  // Read INDEXER_START_LEDGER environment variable
  const startLedgerEnv = process.env.INDEXER_START_LEDGER;
  if (startLedgerEnv !== undefined) {
    const startLedger = parseInt(startLedgerEnv, 10);
    if (!isNaN(startLedger)) {
      indexerStartLedger = startLedger;
      if (startLedger !== 0) {
        console.warn(`INDEXER_START_LEDGER override active: starting from ledger ${startLedger}`);
      }
    } else {
      console.error('Invalid INDEXER_START_LEDGER value, must be a number');
    }
  }
}

export function startIndexer(intervalMs = 10000): void {
  if (indexerInterval) {
    return;
  }

  console.log(`Starting event indexer with ${intervalMs}ms interval`);
  indexerInterval = setInterval(() => {
    indexEvents().catch((err) => {
      console.error("Indexer error:", err);
    });
  }, intervalMs);

  // Run immediately on start
  indexEvents().catch((err) => {
    console.error("Initial indexer error:", err);
  });
}

export function stopIndexer(): void {
  if (indexerInterval) {
    clearInterval(indexerInterval);
    indexerInterval = null;
    console.log("Event indexer stopped");
  }
}

async function indexEvents(): Promise<void> {
  if (!rpcServer || !contractId) {
    return;
  }

  const state = circuitBreaker.getState();
  if (state === CircuitState.OPEN) {
    return;
  }

  try {
    const db = getDb();
    const latestLedger = await rpcServer.getLatestLedger();
    const currentLedger = latestLedger.sequence;

    if (lastProcessedLedger === 0) {
      const cursor = db.prepare("SELECT last_ledger_sequence FROM indexer_cursor WHERE id = 1").get() as any;
      if (cursor) {
        lastProcessedLedger = cursor.last_ledger_sequence;
      } else {
        lastProcessedLedger = indexerStartLedger !== null ? indexerStartLedger : currentLedger - 1;
        db.prepare(`
          INSERT INTO indexer_cursor (id, last_ledger_sequence)
          VALUES (1, ?)
          ON CONFLICT(id) DO UPDATE SET last_ledger_sequence = excluded.last_ledger_sequence
        `).run(lastProcessedLedger);
      }
    }

    if (currentLedger <= lastProcessedLedger) {
      circuitBreaker.onSuccess();
      return;
    }

    // Fetch events from last processed to current
    const events = await rpcServer.getEvents({
      startLedger: lastProcessedLedger + 1,
      filters: [
        {
          type: "contract",
          contractIds: [contractId],
        },
      ],
    });

    const startLedger = lastProcessedLedger; // captured before the tx updates it

    // Use a transaction to ensure events and cursor are updated atomically.
    // This prevents duplicate events if the process crashes mid-batch.
    db.transaction(() => {
      for (const event of events.events || []) {
        processEvent(db, event);
        eventsIndexedTotal.inc();
      }

      lastProcessedLedger = currentLedger;
      db.prepare(`
        INSERT INTO indexer_cursor (id, last_ledger_sequence)
        VALUES (1, ?)
        ON CONFLICT(id) DO UPDATE SET last_ledger_sequence = excluded.last_ledger_sequence
      `).run(currentLedger);
    })();

    ledgersScannedTotal.inc(currentLedger - startLedger);
    circuitBreaker.onSuccess();
  } catch (err) {
    circuitBreaker.onFailure();
    indexerErrorsTotal.inc();
    console.error("Failed to index events:", err);
  }
}

/**
 * Processes a single contract event and records it in history.
 * Note: This is now synchronous to support database transactions.
 */
function processEvent(db: any, event: rpc.Api.EventResponse): void {
  try {
    const topic = event.topic.map((t: any) => scValToNative(t));
    const value = scValToNative(event.value);

    // Event topics are [contract_symbol, event_name]
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
          value.sender,
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
          value.recipient,
          value.amount,
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
          value.sender,
          undefined,
          undefined,
          event.ledger,
        );
        break;
    }
  } catch (err) {
    console.error("Failed to process event:", err);
  }
}
