import { createHmac } from "crypto";
import { getDb } from "./db";
import { logger } from "../logger";
import { validateWebhookUrl } from "./webhookUrl";

export { validateWebhookUrl } from "./webhookUrl";

export function computeSignature(secret: string, body: string): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

const MAX_RETRIES = 5;
const RETRY_DELAYS = [5, 15, 60, 300, 900]; // seconds: 5s, 15s, 60s, 300s, 900s 

export interface WebhookSignalContext {
  /** Correlation identifier for the event (stream id when available). */
  streamId?: string | number;
  /** Optional request id to link logs across services. */
  requestId?: string;
  /** Optional dead-letter row id being transitioned. */
  deadLetterId?: number;
}

export type WebhookOutcome =
  | "queued"
  | "skipped_no_destination"
  | "skipped_invalid_url"
  | "unmapped_stream_id"
  | "queue_failed"
  | "requeued_dead_letter"
  | "dead_letter_not_found"
  | "requeue_failed";

function emitSignal(
  outcome: WebhookOutcome,
  context: WebhookSignalContext,
  extra: Record<string, unknown> = {}
): void {
  // Structured outcome signal. Never include wallet secrets or full credentials.
  const signal = {
    outcome,
    streamId: context.streamId,
    requestId: context.requestId,
    deadLetterId: context.deadLetterId,
    ...extra,
  };
  logger.info(signal, "webhook outcome");
}

export interface WebhookDeliveryRecord {
  id: number;
  stream_id: string;
  event: string;
  payload: string;
  attempt: number;
  max_attempts: number;
  status: "pending" | "success";
  next_retry_at: number | null;
  created_at: number;
  last_attempt_at: number | null;
  error_message: string | null;
}

export interface WebhookDeliveryAttemptResult {
  id: number;
  stream_id: string;
  event: string;
  status: "success" | "pending" | "dead_lettered";
  attempt: number;
  max_attempts: number;
  next_retry_at: number | null;
  last_attempt_at: number;
  error_message: string | null;
  delay_seconds?: number;
  dead_letter_id?: number;
}

export interface NextRetryState {
  status: "pending" | "dead_lettered";
  attempt: number;
  max_attempts: number;
  delaySeconds: number | null;
  next_retry_at: number | null;
}

/**
 * Computes the next retry state after a failed delivery attempt.
 *
 * Consistency rule:
 * - Each delivery attempt increments `attempt` by 1 (`currentAttempt + 1`).
 * - While `attempt < maxAttempts`, the delivery stays `pending` and
 *   `next_retry_at = nowSeconds + getRetryDelaySeconds(attempt - 1)`.
 * - Once `attempt >= maxAttempts`, retry budget is exhausted (`dead_lettered`)
 *   and `next_retry_at` is `null`.
 */
export function computeNextRetryState(
  currentAttempt: number,
  maxAttempts: number,
  nowSeconds: number,
): NextRetryState {
  const safeCurrentAttempt = Number.isFinite(currentAttempt) && currentAttempt >= 0 ? Math.floor(currentAttempt) : 0;
  const safeMaxAttempts = Number.isFinite(maxAttempts) && maxAttempts > 0 ? Math.floor(maxAttempts) : MAX_RETRIES;
  const nextAttempt = safeCurrentAttempt + 1;

  if (nextAttempt >= safeMaxAttempts) {
    return {
      status: "dead_lettered",
      attempt: nextAttempt,
      max_attempts: safeMaxAttempts,
      delaySeconds: null,
      next_retry_at: null,
    };
  }

  const delaySeconds = getRetryDelaySeconds(nextAttempt - 1);
  return {
    status: "pending",
    attempt: nextAttempt,
    max_attempts: safeMaxAttempts,
    delaySeconds,
    next_retry_at: nowSeconds + delaySeconds,
  };
}

export const triggerWebhook = async (
  event: string,
  data: any,
): Promise<WebhookDeliveryRecord | null> => {
  const url = process.env.WEBHOOK_DESTINATION_URL;
  const streamId = data?.stream_id || data?.id;
  const context: WebhookSignalContext = {
    streamId,
    requestId: data?.request_id,
  };

  if (!url) {
    logger.info({ event }, "webhook skipped because destination URL is not set");
    emitSignal("skipped_no_destination", context, { event });
    return;
  }

  const urlValidation = validateWebhookUrl(url);
  if (!urlValidation.valid) {
    logger.error({ event, reason: urlValidation.reason }, "webhook skipped because destination URL is invalid");
    emitSignal("skipped_invalid_url", context, { event, reason: urlValidation.reason });
    return;
  }

  if (!streamId) {
    logger.error({ event, data }, "webhook event could not be mapped to a stream ID");
    emitSignal("unmapped_stream_id", context, { event });
    return;
  }

  try {
    const db = getDb();
    const stmt = db.prepare(`
INSERT INTO webhook_deliveries (stream_id, event, payload, attempt, max_attempts, status, next_retry_at, created_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`);

    // Queue for immediate delivery relative to the worker's polling cycle
    const now = Math.floor(Date.now() / 1000);
    stmt.run(
      streamId,
      event,
      JSON.stringify(data),
      0, // attempt
      MAX_RETRIES, // max_attempts
      'pending', // status
      now, // next_retry_at
      now // created_at
    );
    logger.info({ event, streamId }, "webhook delivery queued");
    emitSignal("queued", context, { event });
  } catch (error: any) {
    logger.error({ err: error, event }, "failed to queue webhook event");
    emitSignal("queue_failed", context, { event, errorName: error?.name });
  }
};

/**
 * Atomically marks a pending webhook delivery as succeeded.
 * Increments `attempt` by 1, records `last_attempt_at`, and clears `next_retry_at` and `error_message`
 * so a succeeded delivery cannot be re-picked up or retain stale error state.
 */
export function recordDeliverySuccess(
  id: number,
  nowSeconds = Math.floor(Date.now() / 1000),
): WebhookDeliveryAttemptResult | null {
  const db = getDb();

  return db.transaction((): WebhookDeliveryAttemptResult | null => {
    const current = db
      .prepare(`SELECT * FROM webhook_deliveries WHERE id = ?`)
      .get(id) as WebhookDeliveryRecord | undefined;

    if (!current || current.status !== "pending") {
      return null;
    }

    const nextAttempt = current.attempt + 1;
    const updateResult = db
      .prepare(
        `UPDATE webhook_deliveries
         SET status = 'success',
             attempt = ?,
             last_attempt_at = ?,
             next_retry_at = NULL,
             error_message = NULL
         WHERE id = ? AND status = 'pending'`,
      )
      .run(nextAttempt, nowSeconds, id);

    if (!updateResult || updateResult.changes !== 1) {
      throw new Error(`Failed to commit success state for webhook delivery ${id}`);
    }

    const committed = db
      .prepare(`SELECT * FROM webhook_deliveries WHERE id = ?`)
      .get(id) as WebhookDeliveryRecord | undefined;

    if (!committed || committed.status !== "success") {
      throw new Error(`Committed webhook delivery ${id} did not persist success status`);
    }

    return {
      id: committed.id,
      stream_id: committed.stream_id,
      event: committed.event,
      status: "success",
      attempt: committed.attempt,
      max_attempts: committed.max_attempts,
      next_retry_at: committed.next_retry_at,
      last_attempt_at: committed.last_attempt_at ?? nowSeconds,
      error_message: committed.error_message,
    };
  })();
}

/**
 * Atomically records a failed webhook delivery attempt.
 * Either schedules the next retry with updated `attempt` and `next_retry_at`,
 * or atomically moves the delivery to `webhook_dead_letters` and deletes it from `webhook_deliveries`
 * when `attempt + 1 >= max_attempts`.
 */
export function recordDeliveryFailure(
  id: number,
  url: string,
  errorMsg: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): WebhookDeliveryAttemptResult | null {
  const db = getDb();

  return db.transaction((): WebhookDeliveryAttemptResult | null => {
    const current = db
      .prepare(`SELECT * FROM webhook_deliveries WHERE id = ?`)
      .get(id) as WebhookDeliveryRecord | undefined;

    if (!current || current.status !== "pending") {
      return null;
    }

    const retryState = computeNextRetryState(
      current.attempt,
      current.max_attempts,
      nowSeconds,
    );

    if (retryState.status === "dead_lettered") {
      const insertResult = db
        .prepare(
          `INSERT INTO webhook_dead_letters (stream_id, event, url, payload, last_error, failed_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .run(
          current.stream_id,
          current.event,
          url,
          current.payload,
          errorMsg,
          nowSeconds,
        );

      const deleteResult = db
        .prepare(`DELETE FROM webhook_deliveries WHERE id = ? AND status = 'pending'`)
        .run(id);

      if (
        !insertResult ||
        insertResult.changes !== 1 ||
        !deleteResult ||
        deleteResult.changes !== 1
      ) {
        throw new Error(`Failed to atomically move webhook delivery ${id} to dead letters`);
      }

      return {
        id: current.id,
        stream_id: current.stream_id,
        event: current.event,
        status: "dead_lettered",
        attempt: retryState.attempt,
        max_attempts: retryState.max_attempts,
        next_retry_at: null,
        last_attempt_at: nowSeconds,
        error_message: errorMsg,
        dead_letter_id: Number(insertResult.lastInsertRowid),
      };
    }

    const updateResult = db
      .prepare(
        `UPDATE webhook_deliveries
         SET attempt = ?,
             last_attempt_at = ?,
             next_retry_at = ?,
             error_message = ?
         WHERE id = ? AND status = 'pending'`,
      )
      .run(
        retryState.attempt,
        nowSeconds,
        retryState.next_retry_at,
        errorMsg,
        id,
      );

    if (!updateResult || updateResult.changes !== 1) {
      throw new Error(`Failed to commit retry state for webhook delivery ${id}`);
    }

    const committed = db
      .prepare(`SELECT * FROM webhook_deliveries WHERE id = ?`)
      .get(id) as WebhookDeliveryRecord | undefined;

    if (!committed || committed.status !== "pending") {
      throw new Error(`Committed webhook delivery ${id} did not persist pending retry state`);
    }

    return {
      id: committed.id,
      stream_id: committed.stream_id,
      event: committed.event,
      status: "pending",
      attempt: committed.attempt,
      max_attempts: committed.max_attempts,
      next_retry_at: committed.next_retry_at,
      last_attempt_at: committed.last_attempt_at ?? nowSeconds,
      error_message: committed.error_message,
      delay_seconds: retryState.delaySeconds ?? undefined,
    };
  })();
}

export function getDeadLetters(limit = 100, offset = 0): any[] {
  const db = getDb();
  return db
    .prepare(`SELECT * FROM webhook_dead_letters ORDER BY failed_at DESC LIMIT ? OFFSET ?`)
    .all(limit, offset);
}

export function countDeadLetters(): number {
  const db = getDb();
  const row = db
    .prepare(`SELECT COUNT(*) as count FROM webhook_dead_letters`)
    .get() as { count: number };
  return row.count;
}

export function pruneDeadLettersOlderThan(cutoffTimestamp: number): number {
  const db = getDb();
  const result = db
    .prepare(`DELETE FROM webhook_dead_letters WHERE failed_at < ?`)
    .run(cutoffTimestamp);
  return result.changes;
}

export function clearDeadLetters(): number {
  const db = getDb();
  const result = db.prepare(`DELETE FROM webhook_dead_letters`).run();
  return result.changes;
}

export function requeueDeadLetter(id: number, context: WebhookSignalContext = {}): boolean {
  const db = getDb();
  const signalContext: WebhookSignalContext = { ...context, deadLetterId: id };
  const startedAt = Date.now();

  try {
    const requeued = db.transaction(() => {
      const deadLetter = db
        .prepare(`SELECT * FROM webhook_dead_letters WHERE id = ?`)
        .get(id) as any;
      if (!deadLetter) return false;

      const now = Math.floor(Date.now() / 1000);
      db.prepare(`
INSERT INTO webhook_deliveries (stream_id, event, payload, attempt, max_attempts, status, next_retry_at, created_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?)
`).run(
        deadLetter.stream_id,
        deadLetter.event,
        deadLetter.payload,
        0, // reset attempt
        5, // max_attempts
        'pending',
        now, // immediate retry
        now
      );

      db.prepare(`DELETE FROM webhook_dead_letters WHERE id = ?`).run(id);
      return true;
    })();

    const latencyMs = Date.now() - startedAt;
    if (!requeued) {
      emitSignal("dead_letter_not_found", signalContext, { latencyMs });
      return false;
    }

    emitSignal("requeued_dead_letter", signalContext, { latencyMs });
    return true;
  } catch (error: any) {
    // Worker restart during dead-letter transition can surface as a transaction failure.
    // Emit a structured outcome with latency so operators can distinguish this from a normal empty case.
    const latencyMs = Date.now() - startedAt;
    logger.error(
      { err: error, streamId: signalContext.streamId, requestId: signalContext.requestId, deadLetterId: id },
      "failed to requeue webhook dead letter"
    );
    emitSignal("requeue_failed", signalContext, {
      latencyMs,
      errorName: error?.name,
      // Indicates the transition may have been interrupted by a worker restart.
      workerRestartSuspected: true,
    });
    return false;
  }
}

export function requeueDeadLetter(id: number): boolean {
  return requeueDeadLetterWithState(id) !== null;
}

export function getRetryDelaySeconds(attemptNumber: number): number {
  if (attemptNumber < 0 || attemptNumber >= RETRY_DELAYS.length) {
    return RETRY_DELAYS[RETRY_DELAYS.length - 1];
  }
  return RETRY_DELAYS[attemptNumber];
}
