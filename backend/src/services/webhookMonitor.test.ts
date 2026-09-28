import { describe, it, expect, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import { initDb, getDb } from "./db";
import {
  WEBHOOK_OUTCOME_CODES,
  classifyWebhookOutcome,
  getWebhookOutcomeSignal,
  refreshWebhookMetrics,
  type WebhookQueueSnapshot,
} from "./webhookMonitor";
import { register } from "./metrics";

const TEST_DB_PATH = path.join(__dirname, "..", "..", "data", "webhook-monitor-test.db");
const DESTINATION = "https://receiver.internal.example/hook";

const EMPTY: Omit<WebhookQueueSnapshot, "destinationConfigured"> = {
  pending: 0,
  dueNow: 0,
  scheduledRetries: 0,
  deadLetters: 0,
  delivered: 0,
};

describe("classifyWebhookOutcome", () => {
  it("reports success when nothing is queued or dead-lettered", () => {
    const signal = classifyWebhookOutcome({ ...EMPTY, destinationConfigured: true });

    expect(signal.outcome).toBe("success");
    expect(signal.outcomeCode).toBe(WEBHOOK_OUTCOME_CODES.success);
    expect(signal.counts).toEqual(EMPTY);
  });

  it("reports transient_delay while retries are still within budget", () => {
    const signal = classifyWebhookOutcome({
      ...EMPTY,
      pending: 3,
      dueNow: 1,
      scheduledRetries: 2,
      destinationConfigured: true,
    });

    expect(signal.outcome).toBe("transient_delay");
    expect(signal.outcomeCode).toBe(WEBHOOK_OUTCOME_CODES.transient_delay);
    expect(signal.detail).toMatch(/retry budget is intact/i);
  });

  it("reports blocked once deliveries exhaust their retry budget", () => {
    const signal = classifyWebhookOutcome({
      ...EMPTY,
      pending: 4,
      dueNow: 4,
      deadLetters: 2,
      destinationConfigured: true,
    });

    expect(signal.outcome).toBe("blocked");
    expect(signal.outcomeCode).toBe(WEBHOOK_OUTCOME_CODES.blocked);
    expect(signal.detail).toMatch(/remained unavailable/i);
  });

  it("reports blocked when work is queued but no destination is configured", () => {
    const signal = classifyWebhookOutcome({
      ...EMPTY,
      pending: 2,
      dueNow: 2,
      destinationConfigured: false,
    });

    expect(signal.outcome).toBe("blocked");
    expect(signal.detail).toMatch(/WEBHOOK_DESTINATION_URL/);
  });

  it("keeps an unconfigured destination at success when there is no work", () => {
    const signal = classifyWebhookOutcome({ ...EMPTY, destinationConfigured: false });

    expect(signal.outcome).toBe("success");
  });

  it("never leaks the destination, payload or stream id in the detail", () => {
    const signal = classifyWebhookOutcome({
      ...EMPTY,
      pending: 1,
      dueNow: 1,
      deadLetters: 1,
      destinationConfigured: true,
    });

    expect(signal.detail).not.toMatch(/https?:\/\//);
    expect(signal.detail).not.toMatch(/stream_id|payload|secret/i);
  });
});

describe("getWebhookOutcomeSignal", () => {
  beforeEach(() => {
    process.env.DB_PATH = TEST_DB_PATH;
    process.env.WEBHOOK_DESTINATION_URL = DESTINATION;
    initDb();
    const db = getDb();
    db.exec("DELETE FROM webhook_deliveries");
    db.exec("DELETE FROM webhook_dead_letters");
    db.exec("DELETE FROM streams");
    db.prepare(
      `INSERT INTO streams (id, sender, recipient, asset_code, total_amount, duration_seconds, start_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run("s1", "sender", "recipient", "USDC", 100, 3600, 0, 0);
  });

  afterEach(() => {
    const db = getDb();
    db.close();
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
  });

  function queueDelivery(attempt: number, nextRetryAt: number | null, status = "pending") {
    const now = Math.floor(Date.now() / 1000);
    getDb()
      .prepare(
        `INSERT INTO webhook_deliveries (stream_id, event, payload, attempt, max_attempts, status, next_retry_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run("s1", "event.created", '{"secret":"do-not-leak"}', attempt, 3, status, nextRetryAt, now);
  }

  it("counts due-now, scheduled and delivered deliveries", () => {
    const now = Math.floor(Date.now() / 1000);
    queueDelivery(1, now - 5);
    queueDelivery(1, now + 600);
    queueDelivery(0, null, "success");

    const signal = getWebhookOutcomeSignal();

    expect(signal.counts.pending).toBe(2);
    expect(signal.counts.dueNow).toBe(1);
    expect(signal.counts.scheduledRetries).toBe(1);
    expect(signal.counts.delivered).toBe(1);
    expect(signal.counts.deadLetters).toBe(0);
    expect(signal.outcome).toBe("transient_delay");
  });

  it("goes blocked once a delivery is dead-lettered", () => {
    const now = Math.floor(Date.now() / 1000);
    getDb()
      .prepare(
        `INSERT INTO webhook_dead_letters (stream_id, event, url, payload, last_error, failed_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run("s1", "event.created", DESTINATION, '{"secret":"do-not-leak"}', "ECONNREFUSED", now);

    const signal = getWebhookOutcomeSignal();

    expect(signal.counts.deadLetters).toBe(1);
    expect(signal.outcome).toBe("blocked");
  });

  it("publishes the outcome and counts to Prometheus", async () => {
    const now = Math.floor(Date.now() / 1000);
    queueDelivery(2, now - 1);
    getDb()
      .prepare(
        `INSERT INTO webhook_dead_letters (stream_id, event, url, payload, last_error, failed_at)
         VALUES (?, ?, ?, ?, ?, ?)`,
      )
      .run("s1", "event.created", DESTINATION, "{}", "ETIMEDOUT", now);

    const signal = refreshWebhookMetrics();
    const scraped = await register.metrics();

    expect(signal.outcome).toBe("blocked");
    expect(scraped).toContain("webhook_outcome");
    expect(scraped).toContain("webhook_dead_letters");
    expect(scraped).toContain("webhook_queue_pending");
  });
});
