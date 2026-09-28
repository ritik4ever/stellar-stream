import { getDb } from "./db";
import {
  webhookDeadLetters as webhookDeadLettersGauge,
  webhookOutcome as webhookOutcomeGauge,
  webhookQueueDueNow as webhookQueueDueNowGauge,
  webhookQueuePending as webhookQueuePendingGauge,
  webhookQueueScheduledRetries as webhookQueueScheduledRetriesGauge,
} from "./metrics";

/**
 * Coarse, secret-free delivery health for the outbound webhook pipeline.
 *
 * - `success` — nothing is queued and nothing has been dead-lettered.
 * - `transient_delay` — deliveries are waiting out a backoff window; the retry
 *   budget is intact and the worker is expected to clear them on its own.
 * - `blocked` — work cannot progress without an owner: the destination has
 *   exhausted its retry budget, or no destination is configured at all.
 */
export type WebhookDeliveryOutcome = "success" | "transient_delay" | "blocked";

/**
 * Stable numeric encoding for the Prometheus gauge and for alert rules.
 * Do not renumber: dashboards and alerts key off these values.
 */
export const WEBHOOK_OUTCOME_CODES: Record<WebhookDeliveryOutcome, number> = {
  success: 0,
  transient_delay: 1,
  blocked: 2,
};

export interface WebhookQueueCounts {
  /** Deliveries that have not reached their terminal success/failure state. */
  pending: number;
  /** Pending deliveries whose retry window has elapsed (worker should pick these up). */
  dueNow: number;
  /** Pending deliveries still waiting out a backoff window. */
  scheduledRetries: number;
  /** Deliveries that exhausted their retry budget. */
  deadLetters: number;
  /** Deliveries already acknowledged by the destination. */
  delivered: number;
}

export interface WebhookQueueSnapshot extends WebhookQueueCounts {
  /** Whether `WEBHOOK_DESTINATION_URL` is set. */
  destinationConfigured: boolean;
}

export interface WebhookOutcomeSignal {
  outcome: WebhookDeliveryOutcome;
  outcomeCode: number;
  /**
   * Owner-actionable explanation. Deliberately carries only counts and state:
   * never the destination URL, a payload, or a stream ID, so it is safe to
   * log, scrape, and paste into an incident channel.
   */
  detail: string;
  counts: WebhookQueueCounts;
}

function toCount(value: unknown): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

/**
 * Classifies a queue snapshot into the three operational outcomes.
 *
 * Precedence matters: an exhausted retry budget (`blocked`) outranks any
 * pending backlog, because a destination that keeps failing needs a human
 * before more retries are worth queueing. A pending backlog with retries
 * still in budget is `transient_delay` — normal, self-healing behaviour that
 * must not page anyone.
 */
export function classifyWebhookOutcome(
  snapshot: WebhookQueueSnapshot,
): WebhookOutcomeSignal {
  const counts: WebhookQueueCounts = {
    pending: snapshot.pending,
    dueNow: snapshot.dueNow,
    scheduledRetries: snapshot.scheduledRetries,
    deadLetters: snapshot.deadLetters,
    delivered: snapshot.delivered,
  };

  let outcome: WebhookDeliveryOutcome;
  let detail: string;

  if (counts.deadLetters > 0) {
    outcome = "blocked";
    detail =
      `${counts.deadLetters} delivery(ies) exhausted their retry budget, so the ` +
      `destination has remained unavailable. Owner action: verify the receiver, ` +
      `then requeue the dead letters.`;
  } else if (!snapshot.destinationConfigured && counts.pending > 0) {
    outcome = "blocked";
    detail =
      `${counts.pending} delivery(ies) are queued but no destination URL is ` +
      `configured. Owner action: set WEBHOOK_DESTINATION_URL.`;
  } else if (counts.pending > 0) {
    outcome = "transient_delay";
    detail =
      `${counts.pending} delivery(ies) in flight (${counts.dueNow} due now, ` +
      `${counts.scheduledRetries} awaiting backoff). Retry budget is intact. ` +
      `Owner action: none while the queued count falls.`;
  } else {
    outcome = "success";
    detail =
      `No webhook deliveries are queued or dead-lettered ` +
      `(${counts.delivered} delivered).`;
  }

  return { outcome, outcomeCode: WEBHOOK_OUTCOME_CODES[outcome], detail, counts };
}

/**
 * Reads the current webhook queue state. Counts only — the query deliberately
 * never selects payload, url, or stream_id.
 */
export function getWebhookQueueSnapshot(): WebhookQueueSnapshot {
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

  return {
    pending: toCount(row?.pending),
    dueNow: toCount(row?.due_now),
    scheduledRetries: toCount(row?.scheduled_retries),
    delivered: toCount(row?.delivered),
    deadLetters: toCount(deadRow?.count),
    destinationConfigured: Boolean(process.env.WEBHOOK_DESTINATION_URL?.trim()),
  };
}

/** Current outcome signal for the webhook pipeline. */
export function getWebhookOutcomeSignal(): WebhookOutcomeSignal {
  return classifyWebhookOutcome(getWebhookQueueSnapshot());
}

/**
 * Publishes the current outcome to Prometheus so alerting does not have to
 * re-derive it from raw counters.
 */
export function refreshWebhookMetrics(): WebhookOutcomeSignal {
  const signal = getWebhookOutcomeSignal();
  webhookQueuePendingGauge.set(signal.counts.pending);
  webhookQueueDueNowGauge.set(signal.counts.dueNow);
  webhookQueueScheduledRetriesGauge.set(signal.counts.scheduledRetries);
  webhookDeadLettersGauge.set(signal.counts.deadLetters);
  webhookOutcomeGauge.set(signal.outcomeCode);
  return signal;
}
