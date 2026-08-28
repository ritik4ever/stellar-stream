import { Counter, Gauge, Histogram, Registry } from "prom-client";
import { getDb } from "./db";

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

// ── HTTP request metrics ──────────────────────────────────────────────────────
// Recorded by middleware/requestLogger, which every request passes through.

export const httpRequestsTotal = new Counter({
  name: "request_count",
  help: "Total number of HTTP requests handled, by method, route and status code",
  labelNames: ["method", "route", "status_code"],
  registers: [register],
});

export const httpRequestDurationMs = new Histogram({
  name: "request_duration_ms",
  help: "HTTP request duration in milliseconds",
  labelNames: ["method", "route"],
  buckets: [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000],
  registers: [register],
});

// ── Stream metrics (DB-backed, refreshed before each scrape) ─────────────────

export const streamCountByStatus = new Gauge({
  name: "stream_count",
  help: "Number of streams by current status",
  labelNames: ["status"],
  registers: [register],
});

export const claimCount = new Gauge({
  name: "claim_count",
  help: "Total number of stream claims recorded",
  registers: [register],
});

export const cancelCount = new Gauge({
  name: "cancel_count",
  help: "Total number of stream cancellations recorded",
  registers: [register],
});

const STREAM_METRICS_CACHE_TTL_MS = 60_000;
let streamMetricsCacheExpiresAt = 0;

/**
 * Refreshes the DB-backed Prometheus gauges (stream_count, claim_count,
 * cancel_count) from the local database. Results are cached for 60s so
 * frequent scrapes do not hammer the DB — the same pattern used by
 * `streamMetrics.ts`. Safe to call on every `/metrics` scrape.
 */
export function refreshPrometheusStreamMetrics(): void {
  const now = Date.now();
  if (now < streamMetricsCacheExpiresAt) {
    return;
  }

  const db = getDb();
  const nowSec = Math.floor(now / 1000);

  // Mirror computeStatus() in streamStore.ts so the label values match what
  // the API reports. Archived streams are excluded — they are historical.
  const statusRows = db
    .prepare(
      `
      SELECT
        CASE
          WHEN canceled_at IS NOT NULL THEN 'canceled'
          WHEN completed_at IS NOT NULL THEN 'completed'
          WHEN paused_at IS NOT NULL THEN 'paused'
          WHEN start_at > @now THEN 'scheduled'
          WHEN (start_at + duration_seconds + paused_duration) <= @now THEN 'completed'
          ELSE 'active'
        END AS status,
        COUNT(*) AS count
      FROM streams
      WHERE archived_at IS NULL
      GROUP BY status
    `,
    )
    .all({ now: nowSec }) as Array<{ status: string; count: number }>;

  // Reset every known status first so labels that no longer have streams
  // report 0 instead of a stale value.
  for (const status of ["scheduled", "active", "paused", "completed", "canceled"]) {
    streamCountByStatus.set({ status }, 0);
  }
  for (const row of statusRows) {
    streamCountByStatus.set({ status: row.status }, Number(row.count));
  }

  const claims = db
    .prepare(`SELECT COUNT(*) AS count FROM stream_events WHERE event_type = 'claimed'`)
    .get() as { count: number } | undefined;
  claimCount.set(Number(claims?.count ?? 0));

  const cancels = db
    .prepare(`SELECT COUNT(*) AS count FROM stream_events WHERE event_type = 'canceled'`)
    .get() as { count: number } | undefined;
  cancelCount.set(Number(cancels?.count ?? 0));

  streamMetricsCacheExpiresAt = now + STREAM_METRICS_CACHE_TTL_MS;
}

/** Clears the scrape-time refresh cache. Intended for tests. */
export function resetPrometheusStreamMetricsCache(): void {
  streamMetricsCacheExpiresAt = 0;
}

// ── Indexer lag ───────────────────────────────────────────────────────────────
// `indexer_lag_seconds` is computed at scrape time (via Gauge.collect) so that
// a completely stalled indexer still produces a growing lag value.

let lastIndexerSuccessAtMs = 0;

/** Records the wall-clock time of a successful indexer poll. */
export function recordIndexerSuccess(): void {
  lastIndexerSuccessAtMs = Date.now();
}

/** Resets lag bookkeeping. Intended for tests. */
export function resetIndexerLag(): void {
  lastIndexerSuccessAtMs = 0;
}

export const indexerLagSeconds = new Gauge({
  name: "indexer_lag_seconds",
  help: "Seconds since the indexer last successfully polled the chain head",
  registers: [register],
  collect() {
    const lagSeconds =
      lastIndexerSuccessAtMs === 0
        ? 0
        : Math.max(0, (Date.now() - lastIndexerSuccessAtMs) / 1000);
    this.set(lagSeconds);
  },
});
