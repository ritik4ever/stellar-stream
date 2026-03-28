import axios from "axios";
import { createHmac } from "crypto";
import { getDb } from "./db";

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

    const db = getDb();
    const now = Date.now();

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
          payload: parsedPayload,
          timestamp,
        };
        const bodyString = JSON.stringify(body);
        const headers: Record<string, string> = {
          "Content-Type": "application/json",
        };

        const signingSecret = process.env.WEBHOOK_SIGNING_SECRET;
        if (signingSecret) {
          const signature = createHmac("sha256", signingSecret)
            .update(bodyString)
            .digest("hex");
          headers["X-Webhook-Signature"] = `sha256=${signature}`;
        }

        await axios.post(url, bodyString, { headers });
        success = true;
      } catch (error: any) {
        errorMsg = error.message || "Unknown error";
        console.error(`[WebhookWorker] Delivery attempt ${attempt + 1} failed for delivery ${id}:`, errorMsg);
      }

      const updateNow = Date.now();

      if (success) {
        // Mark as success
        db.prepare(
          `UPDATE webhook_deliveries SET status = 'success', last_attempt_at = ? WHERE id = ?`
        ).run(updateNow, id);
        console.log(`[WebhookWorker] Delivery ${id} (${event}) succeeded.`);
      } else {
        // Handle failure and retries
        const newAttempt = attempt + 1;
        if (newAttempt >= max_attempts) {
          db.prepare(
            `UPDATE webhook_deliveries SET status = 'failed', attempt = ?, last_attempt_at = ?, error_message = ? WHERE id = ?`
          ).run(newAttempt, updateNow, errorMsg, id);
          console.error(`[WebhookWorker] Delivery ${id} (${event}) permanently failed after max attempts.`);
        } else {
          // Exponential backoff: 2s, 4s, 8s, etc. (Can be adjusted)
          const delayMs = Math.pow(2, newAttempt) * 1000;
          const nextRetry = updateNow + delayMs;
          
          db.prepare(
            `UPDATE webhook_deliveries SET attempt = ?, last_attempt_at = ?, next_retry_at = ?, error_message = ? WHERE id = ?`
          ).run(newAttempt, updateNow, nextRetry, errorMsg, id);
          console.log(`[WebhookWorker] Delivery ${id} scheduled for retry at ${new Date(nextRetry).toISOString()}`);
        }
      }
    }
  } catch (err: any) {
    console.error("[WebhookWorker] Error processing queue:", err);
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
  console.log(`[WebhookWorker] Started with ${intervalMs}ms interval.`);
};

export const stopWebhookWorker = () => {
  if (pollingInterval) {
    clearInterval(pollingInterval);
    pollingInterval = null;
    console.log("[WebhookWorker] Stopped.");
  }
};
