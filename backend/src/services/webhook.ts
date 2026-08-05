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

export const triggerWebhook = async (event: string, data: any): Promise<void> => {
  const url = process.env.WEBHOOK_DESTINATION_URL;

  if (!url) {
    logger.info({ event }, "webhook skipped because destination URL is not set");
    return;
  }

  const urlValidation = validateWebhookUrl(url);
  if (!urlValidation.valid) {
    logger.error({ event, reason: urlValidation.reason }, "webhook skipped because destination URL is invalid");
    return;
  }

  const streamId = data.stream_id || data.id;

  if (!streamId) {
    logger.error({ event, data }, "webhook event could not be mapped to a stream ID");
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
  } catch (error: any) {
    logger.error({ err: error, event }, "failed to queue webhook event");
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
    .prepare(`DELETE FROM webhook_dead_letters WHERE failed_at < ?`)
    .run(cutoffTimestamp);
  return result.changes;
}

export function clearDeadLetters(): number {
  const db = getDb();
  const result = db.prepare(`DELETE FROM webhook_dead_letters`).run();
  return result.changes;
}

export function requeueDeadLetter(id: number): boolean {
  const db = getDb();
  
  return db.transaction(() => {
    const deadLetter = db.prepare(`SELECT * FROM webhook_dead_letters WHERE id = ?`).get(id) as any;
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
}

export function getRetryDelaySeconds(attemptNumber: number): number {
  if (attemptNumber < 0 || attemptNumber >= RETRY_DELAYS.length) {
    return RETRY_DELAYS[RETRY_DELAYS.length - 1];
  }
  return RETRY_DELAYS[attemptNumber];
}
