import { Counter, Gauge, Registry } from "prom-client";

export const register = new Registry();

export const eventsIndexedTotal = new Counter({
  name: "events_indexed_total",
  help: "Total number of contract events successfully indexed",
  registers: [register],
});

export const ledgersScannedTotal = new Counter({
  name: "ledgers_scanned_total",
  help: "Total number of ledgers scanned by the indexer",
  registers: [register],
});

export const lastIndexedLedger = new Gauge({
  name: "last_indexed_ledger",
  help: "Sequence number of the last ledger processed by the indexer",
  registers: [register],
});

export const indexerLatestLedger = new Gauge({
  name: "indexer_latest_ledger",
  help: "Sequence number of the latest ledger observed from Stellar RPC",
  registers: [register],
});

export const indexerLedgerLag = new Gauge({
  name: "indexer_ledger_lag",
  help: "Difference between the latest RPC ledger and the persisted indexer checkpoint",
  registers: [register],
});

export const indexerErrorsTotal = new Counter({
  name: "indexer_errors_total",
  help: "Total number of errors encountered during indexer polls",
  registers: [register],
});

export const indexerCircuitState = new Gauge({
  name: "indexer_circuit_state",
  help: "Current circuit breaker state: 0=CLOSED, 1=HALF_OPEN, 2=OPEN",
  registers: [register],
});

export const webhookQueuePending = new Gauge({
  name: "webhook_queue_pending",
  help: "Webhook deliveries currently queued (not yet successful or dead-lettered)",
  registers: [register],
});

export const webhookQueueDueNow = new Gauge({
  name: "webhook_queue_due_now",
  help: "Queued webhook deliveries whose retry window has elapsed",
  registers: [register],
});

export const webhookQueueScheduledRetries = new Gauge({
  name: "webhook_queue_scheduled_retries",
  help: "Queued webhook deliveries still waiting out their backoff window",
  registers: [register],
});

export const webhookDeadLetters = new Gauge({
  name: "webhook_dead_letters",
  help: "Webhook deliveries that exhausted their retry budget",
  registers: [register],
});

export const webhookOutcome = new Gauge({
  name: "webhook_outcome",
  help: "Webhook delivery health: 0=success, 1=transient_delay, 2=blocked",
  registers: [register],
});

export const indexerOutcome = new Gauge({
  name: "indexer_outcome",
  help: "Indexer monitoring health: 0=success, 1=transient_delay, 2=blocked",
  registers: [register],
});

export const sqliteRestoreOutcome = new Gauge({
  name: "sqlite_restore_outcome",
  help: "SQLite restore schema check outcome at startup: 0=success, 1=transient_delay, 2=blocked, 3=interrupted",
  registers: [register],
});

export const secretsRotationOutcome = new Gauge({
  name: "secrets_rotation_outcome",
  help: "Secrets rotation (JWT_SECRET / SERVER_SIGNING_KEY) rollout outcome: 0=success, 1=transient_delay, 2=blocked",
  registers: [register],
});
