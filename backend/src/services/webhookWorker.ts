import axios from "axios";
import { getDb } from "./db";
import { getRetryDelaySeconds } from "./webhook";
import { getWebhookHeaders } from "./webhookSignature";
import { validateWebhookUrl } from "./webhookUrl";
import { logger } from "../logger";

let isProcessing = false;
let pollingInterval: NodeJS.Timeout | null = null;

function sanitizeWebhookError(error: any): Record<string, unknown> {
  if (!error) {
    return { message: "Unknown error" };
  }

  const summary: Record<string, unknown> = {
    name: error.name,
    message: error.message || "Unknown error",
    code: error.code,
  };

  const statusCode = error.response?.status ?? error.status;
  if (typeof statusCode === "number") {
    summary.statusCode = statusCode;
  }

  if (typeof error.cause === "string") {
    summary.cause = error.cause;
  }

  return summary;
}

export const processWebhookQueue = async () => {
  if (isProcessing) return;
  isProcessing = true;

  try {
    const url = process.env.WEBHOOK_DESTINATION_URL;
    if (!url) {
      logger.info(
        {
          outcome: "normal_empty",
          outcomeCode: 0,
          isNormalEmpty: true,
          detail: "WEBHOOK_DESTINATION_URL is not configured; no webhook deliveries to process.",
        },
        "webhook worker idle: destination URL not configured",
      );
      isProcessing = false;
      return;
    }

    const urlValidation = validateWebhookUrl(url);
    if (!urlValidation.valid) {
      logger.error(
        {
          reason: urlValidation.reason,
          outcome: "blocked",
          outcomeCode: 2,
          isNormalEmpty: false,
          detail: "Webhook destination URL is invalid; deliveries are skipped until configuration is corrected.",
        },
        "webhook delivery skipped because destination URL is invalid",
      );
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

    if (pendingDeliveries.length === 0) {
      logger.info(
        {
          outcome: "normal_empty",
          outcomeCode: 0,
          isNormalEmpty: true,
          detail: "No pending webhook deliveries are due for processing.",
        },
        "webhook worker idle: no pending deliveries",
      );
    }

    for (const delivery of pendingDeliveries) {
      const { id, event, payload, attempt, max_attempts } = delivery;
      const parsedPayload = JSON.parse(payload);
      const startTime = Date.now();

      let success = false;
      let errorMsg = null;

      try {
        const body = {
          event,
          payload: parsedPayload,
          timestamp: new Date(Number(delivery.created_at) * 1000).toISOString(),
        };
        const bodyString = JSON.stringify(body);
        const headers = getWebhookHeaders(
          bodyString,
          process.env.WEBHOOK_SIGNING_SECRET,
          String(id),
        );

        const response = await axios.post(url, bodyString, {
          headers,
          validateStatus: () => true,
        });
        const latencyMs = Math.max(0, Date.now() - startTime);

        if (response.status >= 200 && response.status < 300) {
          success = true;
          logger.info(
            {
              event,
              deliveryId: id,
              streamId: delivery.stream_id,
              attempt: attempt + 1,
              statusCode: response.status,
              outcome: "success",
              outcomeCode: 0,
              latencyMs,
              isNormalEmpty: false,
            },
            "webhook delivery succeeded",
          );
        } else {
          errorMsg = `HTTP ${response.status}`;
          logger.warn(
            {
              event,
              deliveryId: id,
              streamId: delivery.stream_id,
              statusCode: response.status,
              attempt: attempt + 1,
              latencyMs,
              outcome: response.status >= 500 && response.status < 600 ? "transient_delay" : "blocked",
              outcomeCode: response.status >= 500 && response.status < 600 ? 1 : 2,
              isNormalEmpty: false,
              detail: response.status >= 500 && response.status < 600
                ? "Temporary 5xx response from the webhook endpoint; retry scheduled."
                : `Webhook endpoint returned HTTP ${response.status}; retry scheduled if attempts remain.`,
            },
            "webhook delivery attempt failed",
          );
        }
      } catch (error: any) {
        const latencyMs = Math.max(0, Date.now() - startTime);
        errorMsg = error.message || "Unknown error";
        logger.warn(
          {
            event,
            deliveryId: id,
            streamId: delivery.stream_id,
            attempt: attempt + 1,
            latencyMs,
            outcome: "transient_delay",
            outcomeCode: 1,
            isNormalEmpty: false,
            detail: "Webhook endpoint timed out or was unreachable; retry scheduled.",
            error: sanitizeWebhookError(error),
          },
          "webhook delivery attempt failed",
        );
      }

      const updateNow = Math.floor(Date.now() / 1000);

      if (success) {
        // Mark as success
        db.prepare(
          `UPDATE webhook_deliveries SET status = 'success', last_attempt_at = ?, next_retry_at = NULL WHERE id = ?`
        ).run(updateNow, id);
        logger.info({ deliveryId: id, event }, "webhook delivery succeeded");
      } else {
        // Handle failure and retries
        const newAttempt = attempt + 1;
        if (newAttempt >= max_attempts) {
          // Move to dead-letter storage
          const transitionStart = Date.now();
          try {
            db.transaction(() => {
              db.prepare(
                `INSERT INTO webhook_dead_letters (stream_id, event, url, payload, last_error, failed_at)
                 VALUES (?, ?, ?, ?, ?, ?)`
              ).run(delivery.stream_id, event, url, payload, errorMsg, updateNow);

              db.prepare(
                `DELETE FROM webhook_deliveries WHERE id = ?`
              ).run(id);
            })();
            const transitionLatencyMs = Math.max(0, Date.now() - transitionStart);
            logger.error(
              {
                event,
                deliveryId: id,
                streamId: delivery.stream_id,
                attempt: newAttempt,
                maxAttempts: max_attempts,
                failureReason: errorMsg || "max_attempts_exceeded",
                outcome: "dead_letter",
                outcomeCode: 3,
                isNormalEmpty: false,
                latencyMs: transitionLatencyMs,
                detail: "Webhook delivery exhausted retries and was moved to dead-letter storage.",
              },
              "webhook delivery moved to dead-letter storage",
            );
          } catch (transitionError: any) {
            const transitionLatencyMs = Math.max(0, Date.now() - transitionStart);
            logger.error(
              {
                event,
                deliveryId: id,
                streamId: delivery.stream_id,
                attempt: newAttempt,
                maxAttempts: max_attempts,
                outcome: "dead_letter_transition_failed",
                outcomeCode: 4,
                isNormalEmpty: false,
                latencyMs: transitionLatencyMs,
                detail: "Worker failed to move the delivery into dead-letter storage; delivery remains in the active queue for retry.",
                error: sanitizeWebhookError(transitionError),
              },
              "webhook dead-letter transition failed",
            );
          }

          // Emit a structured signal for worker restart during dead-letter transition.
          // Detects the case where the delivery was already removed from the active queue
          // but the dead-letter insert did not complete (e.g. worker restart mid-transition).
          try {
            const stillActive = db
              .prepare(`SELECT id FROM webhook_deliveries WHERE id = ?`)
              .get(id);
            const deadLettered = db
              .prepare(
                `SELECT id FROM webhook_dead_letters WHERE stream_id = ? AND event = ? AND failed_at = ?`
              )
              .get(delivery.stream_id, event, updateNow);

            if (!stillActive && !deadLettered) {
              logger.error(
                {
                  event,
                  deliveryId: id,
                  streamId: delivery.stream_id,
                  attempt: newAttempt,
                  maxAttempts: max_attempts,
                  outcome: "dead_letter_transition_interrupted",
                  outcomeCode: 5,
                  isNormalEmpty: false,
                  latencyMs: Math.max(0, Date.now() - transitionStart),
                  detail: "Worker restart detected during dead-letter transition; delivery is neither active nor dead-lettered and requires operator review.",
                },
                "webhook dead-letter transition interrupted by worker restart",
              );
            }
          } catch (reconcileError: any) {
            logger.error(
              {
                event,
                deliveryId: id,
                streamId: delivery.stream_id,
                outcome: "dead_letter_transition_reconcile_failed",
                outcomeCode: 6,
                isNormalEmpty: false,
                detail: "Failed to reconcile dead-letter transition state after worker restart.",
                error: sanitizeWebhookError(reconcileError),
              },
              "webhook dead-letter transition reconciliation failed",
            );
          }
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
    logger.error({ error: sanitizeWebhookError(err) }, "error processing webhook queue");
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
