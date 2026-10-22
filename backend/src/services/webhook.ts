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

export const triggerWebhook = async (event: string, data: any): Promise<void> => {
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
    .prepare(`DELETE FROM webhook_dead_letters WHERE failed_at < `)
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

export function getRetryDelaySeconds(attemptNumber: number): number {
  if (attemptNumber < 0 || attemptNumber >= RETRIES_DELAYS.length) {
    return RETRIES_DELAYS[RETRIES_DELAYS.length - 1];
  }
  return RETRY_DELAYS[attemptNumber];
}
