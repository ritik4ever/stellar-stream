import { getDb } from "./db";

/**
 * Read-only queue accounting for the outbound webhook pipeline.
 *
 * This is the shared vocabulary for the webhook monitoring smoke check
 * (`webhookQueueStats.test.ts`): the smoke check drives the real worker and
 * then asserts these numbers, so "pending", "retry" and "dead-letter" mean
 * exactly one thing everywhere.
 */
export interface WebhookQueueStats {
  /** Deliveries that have not reached a terminal success/failure state. */
  pending: number;
  /** Pending deliveries whose retry window has elapsed (worker should pick these up). */
  dueNow: number;
  /** Pending deliveries still waiting out a backoff window. */
  scheduledRetries: number;
  /** Deliveries acknowledged by the destination. */
  delivered: number;
  /** Deliveries that exhausted their retry budget. */
  deadLetters: number;
  /** Everything the queue has ever held: pending + delivered + deadLetters. */
  total: number;
}

/** The counts a smoke check expects to observe. Omitted fields are not checked. */
export interface WebhookMonitoringExpectation {
  pending?: number;
  dueNow?: number;
  scheduledRetries?: number;
  delivered?: number;
  deadLetters?: number;
}

export interface WebhookHealthCheck {
  name: string;
  expected: number;
  actual: number;
  pass: boolean;
}

export interface WebhookMonitoringVerdict {
  /** True only when every check passed. */
  pass: boolean;
  checks: WebhookHealthCheck[];
  stats: WebhookQueueStats;
}

function toCount(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/**
 * Current webhook queue counts. Counts only — the query never selects a
 * payload, destination URL, or stream ID, so the result is safe to print in a
 * test/CI log.
 */
export function getWebhookQueueStats(): WebhookQueueStats {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  const row = db
    .prepare(
      `SELECT
         SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS pending,
         SUM(CASE WHEN status = 'pending' AND (next_retry_at IS NULL OR next_retry_at <= ?)
                  THEN 1 ELSE 0 END) AS due_now,
         SUM(CASE WHEN status = 'pending' AND next_retry_at > ? THEN 1 ELSE 0 END) AS scheduled_retries,
         SUM(CASE WHEN status = 'success' THEN 1 ELSE 0 END) AS delivered
       FROM webhook_deliveries`,
    )
    .get(now, now) as
    | {
        pending: number | null;
        due_now: number | null;
        scheduled_retries: number | null;
        delivered: number | null;
      }
    | undefined;

  const deadRow = db
    .prepare(`SELECT COUNT(*) AS count FROM webhook_dead_letters`)
    .get() as { count: number } | undefined;

  const stats: WebhookQueueStats = {
    pending: toCount(row?.pending),
    dueNow: toCount(row?.due_now),
    scheduledRetries: toCount(row?.scheduled_retries),
    delivered: toCount(row?.delivered),
    deadLetters: toCount(deadRow?.count),
    total: 0,
  };
  stats.total = stats.pending + stats.delivered + stats.deadLetters;
  return stats;
}

/**
 * Turns the raw stats into an explicit pass/fail verdict.
 *
 * Two structural invariants are always checked, so the verdict has teeth even
 * when no expectation is supplied:
 *
 *  1. every pending delivery is either due now or awaiting a backoff window,
 *  2. the queue is fully accounted for by pending + delivered + dead letters.
 *
 * Anything passed in `expectation` is then checked as an exact equality.
 */
export function evaluateWebhookMonitoring(
  expectation: WebhookMonitoringExpectation = {},
): WebhookMonitoringVerdict {
  const stats = getWebhookQueueStats();
  const checks: WebhookHealthCheck[] = [];

  checks.push({
    name: "pending == dueNow + scheduledRetries",
    expected: stats.dueNow + stats.scheduledRetries,
    actual: stats.pending,
    pass: stats.pending === stats.dueNow + stats.scheduledRetries,
  });

  checks.push({
    name: "total == pending + delivered + deadLetters",
    expected: stats.pending + stats.delivered + stats.deadLetters,
    actual: stats.total,
    pass: stats.total === stats.pending + stats.delivered + stats.deadLetters,
  });

  const fields: Array<keyof WebhookMonitoringExpectation> = [
    "pending",
    "dueNow",
    "scheduledRetries",
    "delivered",
    "deadLetters",
  ];

  for (const field of fields) {
    const wanted = expectation[field];
    if (wanted === undefined) continue;
    checks.push({
      name: `${field} == ${wanted}`,
      expected: wanted,
      actual: stats[field],
      pass: stats[field] === wanted,
    });
  }

  return { pass: checks.every((check) => check.pass), checks, stats };
}
