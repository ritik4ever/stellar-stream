import axios from "axios";
import { getDb } from "./db";
import { getRetryDelaySeconds } from "./webhook";
import { getWebhookHeaders } from "./webhookSignature";
import { validateWebhookUrl } from "./webhookUrl";
import { logger } from "../logger";

let isProcessing = false;
let pollingInterval: NodeJS.Timeout | null = null;

export const processWebhookQueue = async () => {
  if (isProcessing) return;
  isProcessing = true;

  try {
    const url = process.env.WEBHOOK_DESTINATION_URL;
    if (!url) {
      isProcessing = false;
      return;
    }

    const urlValidation = validateWebhookUrl(url);
    if (!urlValidation.valid) {
      logger.error({ reason: urlValidation.reason }, "webhook delivery skipped because destination URL is invalid");
      isProcessing = false;
      return;
    }

    const db = getDb();
    const now = Math.floor(Date.now() / 1000);

    // Fetch pending deliveries that are due
    const pendingDeliveries = db
      .prepare(
        `SELECT * FROM webhook_deliveries 
         WHERE status = 'pending' AND next_retry_at <= ? 
         ORDER BY next_retry_at ASC LIMIT 10`
      )
      .all(now);

    for (const delivery of pendingDeliveries) {
      const { id, event, payload, attempt, max_attempts } = delivery;
      const parsedPayload = JSON.parse(payload);

      let success = false;
      let errorMsg = null;

      try {
        const timestamp = new Date().toISOString();
        const body = {
          event,
          stream_id: delivery.stream_id,
          timestamp,
          data: parsedPayload,
        };
        const bodyString = JSON.stringify(body);
        const headers = getWebhookHeaders(
          bodyString,
          process.env.WEBHOOK_SIGNING_SECRET,
        );

        await axios.post(url, bodyString, { headers });
        success = true;
      } catch (error: any) {
        errorMsg = error.message || "Unknown error";
        logger.error({ err: error, deliveryId: id, attempt: attempt + 1 }, "webhook delivery attempt failed");
      }

      const updateNow = Math.floor(Date.now() / 1000);

      if (success) {
        // Mark as success
        db.prepare(
          `UPDATE webhook_deliveries SET status = 'success', last_attempt_at = ? WHERE id = ?`
        ).run(updateNow, id);
        logger.info({ deliveryId: id, event }, "webhook delivery succeeded");
      } else {
        // Handle failure and retries
        const newAttempt = attempt + 1;
        if (newAttempt >= max_attempts) {
          // Move to dead-letter storage
          db.prepare(
            `INSERT INTO webhook_dead_letters (stream_id, event, url, payload, last_error, failed_at)
             VALUES (?, ?, ?, ?, ?, ?)`
          ).run(delivery.stream_id, event, url, payload, errorMsg, updateNow);

          db.prepare(
            `DELETE FROM webhook_deliveries WHERE id = ?`
          ).run(id);
          logger.error({ deliveryId: id, event, maxAttempts: max_attempts }, "webhook delivery moved to dead-letter storage");
        } else {
          // Use configured retry delays: 5s, 15s, 60s, 300s, 900s
          const delaySeconds = getRetryDelaySeconds(newAttempt - 1);
          const nextRetry = updateNow + delaySeconds;

          db.prepare(
            `UPDATE webhook_deliveries SET attempt = ?, last_attempt_at = ?, next_retry_at = ?, error_message = ? WHERE id = ?`
          ).run(newAttempt, updateNow, nextRetry, errorMsg, id);
          logger.info(
            { deliveryId: id, event, attempt: newAttempt, delaySeconds, nextRetryAt: new Date(nextRetry * 1000).toISOString() },
            "webhook delivery scheduled for retry",
          );
        }
      }
    }
  } catch (err: any) {
    logger.error({ err }, "error processing webhook queue");
  } finally {
    isProcessing = false;
  }
};

export const startWebhookWorker = (intervalMs: number = 5000) => {
  if (pollingInterval) {
    clearInterval(pollingInterval);
  }
  // Immediately process
  processWebhookQueue();
  // Set interval
  pollingInterval = setInterval(processWebhookQueue, intervalMs);
  logger.info({ intervalMs }, "webhook worker started");
};

export const stopWebhookWorker = () => {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
    logger.info("webhook worker stopped");
  }
};
