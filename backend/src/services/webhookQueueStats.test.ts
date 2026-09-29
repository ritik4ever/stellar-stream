/**
 * Repeatable smoke check for the webhook monitoring workflow.
 *
 * Covers the two operational cases the monitoring signal exists for:
 *
 *  1. a **bursty delivery queue** — many deliveries become due at once and the
 *     worker must drain them without leaving anything pending or dead-lettered;
 *  2. a **destination that remains unavailable** — retries must be scheduled
 *     while the budget lasts, and the delivery must end up dead-lettered rather
 *     than silently dropped.
 *
 * The check drives the real worker against a real database and asserts
 * pending / retry / dead-letter counts through
 * `evaluateWebhookMonitoring()`, which returns an explicit pass/fail verdict.
 * It touches no external network: `axios` is mocked.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import axios from "axios";
import fs from "fs";
import path from "path";
import { initDb, getDb } from "./db";
import { processWebhookQueue } from "./webhookWorker";
import {
  evaluateWebhookMonitoring,
  getWebhookQueueStats,
} from "./webhookQueueStats";

vi.mock("axios");

const TEST_DB_PATH = path.join(__dirname, "..", "..", "data", "webhook-monitoring-smoke-test.db");
const DESTINATION = "https://example.com/webhook";
const BURST_SIZE = 25;

function resetDb() {
  const db = getDb();
  db.exec("DELETE FROM webhook_deliveries");
  db.exec("DELETE FROM webhook_dead_letters");
  db.exec("DELETE FROM streams");
  db.prepare(
    `INSERT INTO streams (id, sender, recipient, asset_code, total_amount, duration_seconds, start_at, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run("s1", "sender", "recipient", "USDC", 100, 3600, 0, 0);
}

function queueDelivery({ attempt = 0, maxAttempts = 3, nextRetryAt }: { attempt?: number; maxAttempts?: number; nextRetryAt?: number }) {
  const now = Math.floor(Date.now() / 1000);
  getDb()
    .prepare(
      `INSERT INTO webhook_deliveries (stream_id, event, payload, attempt, max_attempts, status, next_retry_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run("s1", "event.created", "{}", attempt, maxAttempts, "pending", nextRetryAt ?? now - 5, now);
}

async function drainQueue(maxRounds = 20) {
  for (let round = 0; round < maxRounds; round += 1) {
    await processWebhookQueue();
    if (getWebhookQueueStats().pending === 0) return round + 1;
  }
  return maxRounds;
}

describe("webhook monitoring smoke check", () => {
  beforeEach(() => {
    process.env.DB_PATH = TEST_DB_PATH;
    process.env.WEBHOOK_DESTINATION_URL = DESTINATION;
    initDb();
    resetDb();
    vi.spyOn(console, "log").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    getDb().close();
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
    vi.restoreAllMocks();
  });

  it("drains a bursty delivery queue with a clear pass verdict", async () => {
    (axios.post as any).mockResolvedValue({ status: 200, data: {} });
    for (let i = 0; i < BURST_SIZE; i += 1) queueDelivery({});

    const before = getWebhookQueueStats();
    expect(before.pending).toBe(BURST_SIZE);
    expect(before.dueNow).toBe(BURST_SIZE);

    const rounds = await drainQueue();

    const verdict = evaluateWebhookMonitoring({
      pending: 0,
      dueNow: 0,
      scheduledRetries: 0,
      delivered: BURST_SIZE,
      deadLetters: 0,
    });

    // A burst larger than the worker's per-round batch (10) must still drain.
    expect(rounds).toBeGreaterThan(1);
    expect(verdict.pass).toBe(true);
    expect(verdict.stats.delivered).toBe(BURST_SIZE);
  });

  it("schedules retries and then blocks a delivery whose destination stays unavailable", async () => {
    (axios.post as any).mockRejectedValue(new Error("ECONNREFUSED"));
    queueDelivery({ maxAttempts: 2 });

    // ── Attempt 1: budget remains, so a retry must be scheduled, not dropped.
    await processWebhookQueue();
    const afterFirst = evaluateWebhookMonitoring({
      pending: 1,
      dueNow: 0,
      scheduledRetries: 1,
      delivered: 0,
      deadLetters: 0,
    });
    expect(afterFirst.pass).toBe(true);

    // ── Attempt 2: budget exhausted, so it must land in the dead-letter queue.
    const db = getDb();
    const now = Math.floor(Date.now() / 1000);
    db.prepare("UPDATE webhook_deliveries SET next_retry_at = ?").run(now - 5);
    await processWebhookQueue();

    const verdict = evaluateWebhookMonitoring({
      pending: 0,
      delivered: 0,
      deadLetters: 1,
    });
    expect(verdict.pass).toBe(true);
    expect(verdict.stats.deadLetters).toBe(1);

    const dead = db.prepare("SELECT * FROM webhook_dead_letters").get() as any;
    expect(dead.last_error).toBe("ECONNREFUSED");
    expect(dead.url).toBe(DESTINATION);
  });

  it("fails the verdict when observed counts do not match the expectation", async () => {
    (axios.post as any).mockRejectedValue(new Error("ETIMEDOUT"));
    queueDelivery({ maxAttempts: 2 });
    await processWebhookQueue();

    const verdict = evaluateWebhookMonitoring({ deadLetters: 1, pending: 0 });

    expect(verdict.pass).toBe(false);
    expect(verdict.checks.filter((check) => !check.pass).map((check) => check.name)).toEqual(
      expect.arrayContaining(["pending == 0", "deadLetters == 1"]),
    );
  });

  it("keeps the structural invariants true on an empty queue", () => {
    const verdict = evaluateWebhookMonitoring();

    expect(verdict.pass).toBe(true);
    expect(verdict.checks).toHaveLength(2);
    expect(verdict.stats.total).toBe(0);
  });
});
