import { describe, it, expect, beforeEach, afterEach, vi} from "vitest";
import axios from "axios";
import { processWebhookQueue } from "./webhookWorker";
import { initDb, getDb } from "./db";
import { countDeadLetters } from "./webhook";
import { logger } from "../logger";
import fs from "fs";
import path from "path";

vi.mock("axios");

const TEST_DB_PATH = path.join(__dirname, "..", "..", "data", "worker-test.db");

describe("WebhookWorker", () => {
  beforeEach(() => {
    process.env.DB_PATH = TEST_DB_PATH;
    process.env.WEBHOOK_DESTINATION_URL = "https://example.com/webhook";
    initDb();
    const db = getDb();
    db.exec("DELETE FROM stream_events");
    db.exec("DELETE FROM webhook_deliveries");
    db.exec("DELETE FROM webhook_dead_letters");
    db.exec("DELETE FROM streams");
    
    // Insert dummy stream to avoid foreign key violation
    db.prepare(`
        INSERT INTO streams (id, sender, recipient, asset_code, total_amount, duration_seconds, start_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run("s1", "sender", "recipient", "USDC", 100, 3600, 0, 0);

    vi.spyOn(console, 'log').mockImplementation(() => {});
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    const db = getDb();
    db.close();
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
    vi.restoreAllMocks();
  });

  it("should increment attempt and update next_retry_at on first failure", async () => {
    const db = getDb();
    const now = Math.floor(Date.now() / 1000);
    
    // Insert a pending delivery
    db.prepare(`
      INSERT INTO webhook_deliveries (stream_id, event, payload, attempt, max_attempts, status, next_retry_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run("s1", "event.created", "{}", 0, 3, "pending", now - 10, now - 10);

    // Mock axios failure
    (axios.post as any).mockRejectedValueOnce(new Error("Connection timeout"));

    await processWebhookQueue();

    const delivery = db.prepare("SELECT * FROM webhook_deliveries WHERE stream_id = ?").get("s1") as any;
    expect(delivery.attempt).toBe(1);
    expect(delivery.status).toBe("pending");
    expect(delivery.next_retry_at).toBeGreaterThan(now);
    expect(delivery.error_message).toBe("Connection timeout");
  });

  it("retries a timeout with the same idempotency key and succeeds without another failed attempt", async () => {
    const db = getDb();
    const now = Math.floor(Date.now() / 1000);
    db.prepare(`
      INSERT INTO webhook_deliveries (stream_id, event, payload, attempt, max_attempts, status, next_retry_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run("s1", "event.created",'{"value":1}', 0, 3, "pending", now - 10, now - 10);

    (axios.post as any).mockRejectedValueOnce(new Error("timeout"));
    await processWebhookQueue();

    let delivery = db.prepare("SELECT * FROM webhook_deliveries WHERE stream_id = ?").get("s1") as any;
    expect(delivery.attempt).toBe(1);
    expect(delivery.status).toBe("pending");
    expect(delivery.error_message).toBe("timeout");
    expect(delivery.next_retry_at).toBeGreaterThan(now);

    db.prepare("UPDATE webhook_deliveries SET next_retry_at = ? WHERE id = ?").run(now - 10, delivery.id);
    (axios.post as any).mockResolvedValueOnce({ status: 200 });
    await processWebhookQueue();

    delivery = db.prepare("SELECT * FROM webhook_deliveries WHERE stream_id = ?").get("s1") as any;
    const calls = (axios.post as any).mock.calls;
    expect(calls[0][2].headers["Idempotency-Key"]).toBe(calls[1][2].headers["Idempotency-Key"]);
    expect(calls[0][1]).toBe(calls[1][1]);
    expect(delivery.status).toBe("success");
    expect(delivery.attempt).toBe(1);
    expect(delivery.next_retry_at).toBeNull();
  });

  it("treats a temporary 5xx response as a failed attempt and schedules a retry", async () => {
    const db = getDb();
    const now = Math.floor(Date.now() / 1000);
    db.prepare(`
      INSERT INTO webhook_deliveries (stream_id, event, payload, attempt, max_attempts, status, next_retry_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run("s1", "event.created", "{}", 0, 3, "pending", now - 10, now - 10);

    (axios.post as any).mockResolvedValueOnce({ status: 503 });
    await processWebhookQueue();

    const delivery = db.prepare("SELECT * FROM webhook_deliveries WHERE stream_id = ?").get("s1") as any;
    expect(delivery.status).toBe("pending");
    expect(delivery.attempt).toBe(1);
    expect(delivery.error_message).toBe("HTTP 503");
    expect(delivery.next_retry_at).toBeGreaterThan(now);
  });

  it("logs a transient 5xx signal with the stream ID and sanitised latency details", async () => {
    const db = getDb();
    const now = Math.floor(Date.now() / 1000);
    const loggerSpy = vi.spyOn(logger, "warn");

    db.prepare(`
      INSERT INTO webhook_deliveries (stream_id, event, payload, attempt, max_attempts, status, next_retry_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run("s1", "event.created", "{}", 0, 3, "pending", now - 10, now - 10);

    (axios.post as any).mockResolvedValueOnce({ status: 503 });
    await processWebhookQueue();

    expect(loggerSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "event.created",
        streamId: "s1",
        statusCode: 503,
        outcome: "transient_delay",
        outcomeCode: 1,
        isNormalEmpty: false,
      }),
      expect.any(String),
    );
    const lastCall = loggerSpy.mock.calls[loggerSpy.mock.calls.length - 1];
    expect(lastCall?.[0]).toHaveProperty("latencyMs");
    expect(lastCall?.[0]).not.toHaveProperty("err");
  });

  it("should follow backoff sequence on subsequent failures", async () => {
    const db = getDb();
    const now = Math.floor(Date.now() / 1000);
    
    // Insert a delivery already at attempt 1
    db.prepare(`
      INSERT INTO webhook_deliveries (stream_id, event, payload, attempt, max_attempts, status, next_retry_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run("s1", "event.created", "{}", 1, 3, "pending", now - 10, now - 10);

    (axios.post as any).mockRejectedValueOnce(new Error("500 Internal Server Error"));

    await processWebhookQueue();

    const delivery = db.prepare("SELECT * FROM webhook_deliveries WHERE stream_id = ?").get("s1") as any;
    expect(delivery.attempt).toBe(2);
    // 2nd attempt backoff is 15s (index 1)
    const expectedRetryAt = Math.floor(Date.now() / 1000) + 15;
    expect(delivery.next_retry_at).toBeGreaterThanOrEqual(expectedRetryAt - 2);
    expect(delivery.next_retry_at).toBeLessThanOrEqual(expectedRetryAt + 2);
  });

  it("should move to dead letters and delete from active when max attempts reached", async () => {
    const db = getDb();
    const now = Math.floor(Date.now() / 1000);
    
    // Insert a delivery at attempt 2 (max_attempts = 3)
    db.prepare(`
      INSERT INTO webhook_deliveries (stream_id, event, payload, attempt, max_attempts, status, next_retry_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run("s1", "event.created", '{"foo":"bar"}', 2, 3, "pending", now - 10, now - 10);

    (axios.post as any).mockRejectedValueOnce(new Error("Critical Failure"));

    await processWebhookQueue();

    // Should be deleted from active deliveries
    const active = db.prepare("SELECT * FROM webhook_deliveries WHERE stream_id = ?").get("s1");
    expect(active).toBeUndefined();

    // Should be in dead letters
    const dead = db.prepare("SELECT * FROM webhook_dead_letters").get() as any;
    expect(dead).toBeDefined();
    expect(dead.payload).toBe('{"foo":"bar"}');
    expect(dead.last_error).toBe("Critical Failure");
    expect(dead.url).toBe("https://example.com/webhook");
  });

  it("logs a structured dead-letter outcome with stream ID and latency", async () => {
    const db = getDb();
    const now = Math.floor(Date.now() / 1000);
    const loggerSpy = vi.spyOn(logger, "error");

    db.prepare(`
      INSERT INTO webhook_deliveries (stream_id, event, payload, attempt, max_attempts, status, next_retry_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run("s1", "event.created",'{"foo":"bar"}', 2, 3, "pending", now - 10, now - 10);

    (axios.post as any).mockRejectedValueOnce(new Error("Critical Failure"));
    await processWebhookQueue();

    expect(loggerSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        event: "event.created",
        streamId: "s1",
        outcome: "dead_letter",
        outcomeCode: 3,
        isNormalEmpty: false,
      }),
      expect.any(String),
    );
    const deadLetterCall = loggerSpy.mock.calls.find(
      (call) => (call[0] as any)?.outcome === "dead_letter",
    );
    expect(deadLetterCall).toBeDefined();
    expect(deadLetterCall?.[0]).toHaveProperty("latencyMs");
    expect(deadLetterCall?.[0]).not.toHaveProperty("payload");
  });

  it("should retry 3 times with increasing delay then move to dead letters when webhook returns 500", async () => {
    const db = getDb();
    const now = Math.floor(Date.now() / 1000);

    // Insert a fresh delivery at attempt 0 with max_attempts = 3
    db.prepare(`
      INSERT INTO webhook_deliveries (stream_id, event, payload, attempt, max_attempts, status, next_retry_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).run("s1", "event.created", '{"test":"payload"}', 0, 3, "pending", now - 10, now - 10);

    // ── Attempt 1: 0 → 1 ──
    (axios.post as any).mockRejectedValueOnce(new Error("500 Internal Server Error"));
    await processWebhookQueue();

    let delivery = db.prepare("SELECT * FROM webhook_deliveries WHERE stream_id = ?").get("s1") as any;
    expect(delivery.attempt).toBe(1);
    expect(delivery.status).toBe("pending");
    // Backoff after 1st failure: getRetryDelaySeconds(0) = 5s
    const expectedRetry1 = Math.floor(Date.now() / 1000) + 5;
    expect(delivery.next_retry_at).toBeGreaterThanOrEqual(expectedRetry1 - 3);
    expect(delivery.next_retry_at).toBeLessThanOrEqual(expectedRetry1 + 3);

    // Advance next_retry_at to trigger immediate retry
    db.prepare("UPDATE webhook_deliveries SET next_retry_at = ? WHERE id = ?").run(now - 10, delivery.id);

    // ── Attempt 2: 1 → 2 ──
    (axios.post as any).mockRejectedValueOnce(new Error("500 Internal Server Error"));
    await processWebhookQueue();

    delivery = db.prepare("SELECT * FROM webhook_deliveries WHERE stream_id = ?").get("s1") as any;
    expect(delivery.attempt).toBe(2);
    expect(delivery.status).toBe("pending");
    // Backoff after 2nd failure: getRetryDelaySeconds(1) = 15s
    const expectedRetry2 = Math.floor(Date.now() / 1000) + 15;
    expect(delivery.next_retry_at).toBeGreaterThanOrEqual(expectedRetry2 - 3);
    expect(delivery.next_retry_at).toBeLessThanOrEqual(expectedRetry2 + 3);

    // Advance next_retry_at to trigger immediate retry
    db.prepare("UPDATE webhook_deliveries SET next_retry_at = ? WHERE id = ?").run(now - 10, delivery.id);

    // ── Attempt 3: 2 → 3 (max), should land in dead letters ──
    (axios.post as any).mockRejectedValueOnce(new Error("500 Internal Server Error"));
    await processWebhookQueue();

    // Active delivery should be removed
    const active = db.prepare("SELECT * FROM webhook_deliveries WHERE stream_id = ?").get("s1");
    expect(active).toBeUndefined();

    // Dead letter should contain the failed delivery
    expect(countDeadLetters()).toBe(1);
    const dead = db.prepare("SELECT * FROM webhook_dead_letters").get() as any;
    expect(dead).toBeDefined();
    expect(dead.payload).toBe('{"test":"payload"}');
    expect(dead.last_error).toBe("500 Internal Server Error");
    expect(dead.url).toBe("https://example.com/webhook");
  });

  describe("Edge cases: duplicate delivery after timeout and temporary 5xx (SSB-2026-155)", () => {
    it("reproduces duplicate delivery attempt after timeout: asserts status, response, stored attempt count, next retry time, and absence of duplicate side effects", async () => {
      const db = getDb();
      const baseTime = Math.floor(Date.now() / 1000);

      // Insert fresh pending webhook delivery
      db.prepare(`
        INSERT INTO webhook_deliveries (stream_id, event, payload, attempt, max_attempts, status, next_retry_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run("s1", "stream.created", JSON.stringify({ stream_id: "s1", amount: 500 }), 0, 3, "pending", baseTime - 10, baseTime - 10);

      const initialDelivery = db.prepare("SELECT * FROM webhook_deliveries WHERE stream_id = ?").get("s1") as any;
      expect(initialDelivery.status).toBe("pending");
      expect(initialDelivery.attempt).toBe(0);

      // Attempt 1: Endpoint times out (e.g. read/socket timeout during delivery)
      const timeoutError = new Error("connect ETIMEDOUT 198.51.100.1:443");
      (timeoutError as any).code = "ETIMEDOUT";
      (axios.post as any).mockRejectedValueOnce(timeoutError);

      await processWebhookQueue();

      // Verify Attempt 1 database state:
      // 1. status remains pending
      // 2. stored attempt count incremented to 1
      // 3. error_message stored
      // 4. next retry time scheduled with 5s delay
      // 5. absence of duplicate side effects: exactly 1 row in deliveries, 0 in dead letters
      const afterTimeout = db.prepare("SELECT * FROM webhook_deliveries WHERE id = ?").get(initialDelivery.id) as any;
      expect(afterTimeout).toBeDefined();
      expect(afterTimeout.status).toBe("pending");
      expect(afterTimeout.attempt).toBe(1);
      expect(afterTimeout.error_message).toBe("connect ETIMEDOUT 198.51.100.1:443");
      expect(afterTimeout.last_attempt_at).toBeGreaterThanOrEqual(baseTime - 1);
      const expectedRetryTime1 = afterTimeout.last_attempt_at + 5;
      expect(afterTimeout.next_retry_at).toBe(expectedRetryTime1);

      const allDeliveriesAfterAttempt1 = db.prepare("SELECT * FROM webhook_deliveries").all();
      expect(allDeliveriesAfterAttempt1).toHaveLength(1);
      expect(countDeadLetters()).toBe(0);

      // Fast-forward time to next_retry_at
      db.prepare("UPDATE webhook_deliveries SET next_retry_at = ? WHERE id = ?").run(baseTime - 1, initialDelivery.id);

      // Attempt 2 (Retry): Endpoint successfully responds 200 OK (e.g. recognizes idempotency key)
      (axios.post as any).mockResolvedValueOnce({
        status: 200,
        statusText: "OK",
        data: { received: true, deduplicated: true },
      });

      await processWebhookQueue();

      // Verify Attempt 2 database state:
      // 1. status transitioned to success
      // 2. stored attempt count remains 1 (success does not increment attempt count)
      // 3. next_retry_at is cleared (null)
      // 4. absence of duplicate side effects: exactly 1 row in deliveries, 0 in dead letters
      const afterSuccess = db.prepare("SELECT * FROM webhook_deliveries WHERE id = ?").get(initialDelivery.id) as any;
      expect(afterSuccess).toBeDefined();
      expect(afterSuccess.status).toBe("success");
      expect(afterSuccess.attempt).toBe(1);
      expect(afterSuccess.next_retry_at).toBeNull();

      const allDeliveriesAfterAttempt2 = db.prepare("SELECT * FROM webhook_deliveries").all();
      expect(allDeliveriesAfterAttempt2).toHaveLength(1);
      expect(countDeadLetters()).toBe(0);

      // Verify RPC calls made:
      // Both attempts used the same URL, same payload, and identical Idempotency-Key
      const postCalls = (axios.post as any).mock.calls;
      expect(postCalls).toHaveLength(2);

      const firstCallHeaders = postCalls[0][2].headers;
      const secondCallHeaders = postCalls[1][2].headers;
      expect(firstCallHeaders["Idempotency-Key"]).toBe(`stellar-stream-${initialDelivery.id}`);
      expect(secondCallHeaders["Idempotency-Key"]).toBe(`stellar-stream-${initialDelivery.id}`);
      expect(postCalls[0][1]).toBe(postCalls[1][1]); // Identical body string

      // Verify absence of duplicate delivery: subsequent worker run does NOT re-deliver
      await processWebhookQueue();
      expect((axios.post as any).mock.calls).toHaveLength(2);
    });

    it("reproduces endpoint returning temporary 5xx: asserts status, response, stored attempt count, backoff next retry time, and recovery without duplicate side effects", async () => {
      const db = getDb();
      const baseTime = Math.floor(Date.now() / 1000);

      // Queue delivery with max_attempts = 4
      db.prepare(`
        INSERT INTO webhook_deliveries (stream_id, event, payload, attempt, max_attempts, status, next_retry_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run("s1", "stream.updated", JSON.stringify({ stream_id: "s1", status: "active" }), 0, 4, "pending", baseTime - 10, baseTime - 10);

      const delivery = db.prepare("SELECT * FROM webhook_deliveries WHERE stream_id = ?").get("s1") as any;

      // ── Attempt 1: Endpoint returns temporary 503 Service Unavailable ──
      (axios.post as any).mockResolvedValueOnce({
        status: 503,
        statusText: "Service Unavailable",
        data: { error: "Temporary overload, retry shortly" },
      });

      await processWebhookQueue();

      let current = db.prepare("SELECT * FROM webhook_deliveries WHERE id = ?").get(delivery.id) as any;
      expect(current.status).toBe("pending");
      expect(current.attempt).toBe(1);
      expect(current.error_message).toBe("HTTP 503");
      const expectedRetry1 = current.last_attempt_at + 5; // 1st delay is 5s
      expect(current.next_retry_at).toBe(expectedRetry1);

      // Assert absence of duplicate side effects
      expect(db.prepare("SELECT count(*) as count FROM webhook_deliveries").get()).toEqual({ count: 1 });
      expect(countDeadLetters()).toBe(0);

      // Fast-forward to next retry
      db.prepare("UPDATE webhook_deliveries SET next_retry_at = ? WHERE id = ?").run(baseTime - 1, delivery.id);

      // ── Attempt 2: Endpoint returns temporary 502 Bad Gateway ──
      (axios.post as any).mockResolvedValueOnce({
        status: 502,
        statusText: "Bad Gateway",
        data: { error: "Upstream server error" },
      });

      await processWebhookQueue();

      current = db.prepare("SELECT * FROM webhook_deliveries WHERE id = ?").get(delivery.id) as any;
      expect(current.status).toBe("pending");
      expect(current.attempt).toBe(2);
      expect(current.error_message).toBe("HTTP 502");
      const expectedRetry2 = current.last_attempt_at + 15; // 2nd delay is 15s
      expect(current.next_retry_at).toBe(expectedRetry2);

      expect(db.prepare("SELECT count(*) as count FROM webhook_deliveries").get()).toEqual({ count: 1 });
      expect(countDeadLetters()).toBe(0);

      // Fast-forward to next retry
      db.prepare("UPDATE webhook_deliveries SET next_retry_at = ? WHERE id = ?").run(baseTime - 1, delivery.id);

      // ── Attempt 3: Endpoint returns temporary 500 Internal Server Error ──
      (axios.post as any).mockResolvedValueOnce({
        status: 500,
        statusText: "Internal Server Error",
        data: { error: "Database lock acquired" },
      });

      await processWebhookQueue();

      current = db.prepare("SELECT * FROM webhook_deliveries WHERE id = ?").get(delivery.id) as any;
      expect(current.status).toBe("pending");
      expect(current.attempt).toBe(3);
      expect(current.error_message).toBe("HTTP 500");
      const expectedRetry3 = current.last_attempt_at + 60; // 3rd delay is 60s
      expect(current.next_retry_at).toBe(expectedRetry3);

      expect(db.prepare("SELECT count(*) as count FROM webhook_deliveries").get()).toEqual({ count: 1 });
      expect(countDeadLetters()).toBe(0);

      // Fast-forward to next retry
      db.prepare("UPDATE webhook_deliveries SET next_retry_at = ? WHERE id = ?").run(baseTime - 1, delivery.id);

      // ── Attempt 4: Endpoint recovers and returns 200 OK ──
      (axios.post as any).mockResolvedValueOnce({
        status: 200,
        statusText: "OK",
        data: { success: true },
      });

      await processWebhookQueue();

      current = db.prepare("SELECT * FROM webhook_deliveries WHERE id = ?").get(delivery.id) as any;
      expect(current.status).toBe("success");
      expect(current.attempt).toBe(3); // Preserves attempt count of failed attempts
      expect(current.next_retry_at).toBeNull(); // Cleared on success

      // Absence of duplicate side effects
      expect(db.prepare("SELECT count(*) as count FROM webhook_deliveries").get()).toEqual({ count: 1 });
      expect(countDeadLetters()).toBe(0);

      // Verify all 4 calls carried the identical idempotency key and body
      const postCalls = (axios.post as any).mock.calls;
      expect(postCalls).toHaveLength(4);
      for (const call of postCalls) {
        expect(call[2].headers["Idempotency-Key"]).toBe(`stellar-stream-${delivery.id}`);
        expect(call[1]).toBe(postCalls[0][1]);
      }

      // Subsequent processing does nothing
      await processWebhookQueue();
      expect((axios.post as any).mock.calls).toHaveLength(4);
    });

    it("transitions to dead letters when temporary 5xx persists through max attempts with no duplicate entries", async () => {
      const db = getDb();
      const baseTime = Math.floor(Date.now() / 1000);

      // Queue delivery with max_attempts = 2
      db.prepare(`
        INSERT INTO webhook_deliveries (stream_id, event, payload, attempt, max_attempts, status, next_retry_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run("s1", "stream.closed", JSON.stringify({ stream_id: "s1" }), 0, 2, "pending", baseTime - 10, baseTime - 10);

      const delivery = db.prepare("SELECT * FROM webhook_deliveries WHERE stream_id = ?").get("s1") as any;

      // Attempt 1: 503
      (axios.post as any).mockResolvedValueOnce({ status: 503 });
      await processWebhookQueue();

      let current = db.prepare("SELECT * FROM webhook_deliveries WHERE id = ?").get(delivery.id) as any;
      expect(current.attempt).toBe(1);
      expect(current.status).toBe("pending");
      expect(countDeadLetters()).toBe(0);

      // Fast-forward
      db.prepare("UPDATE webhook_deliveries SET next_retry_at = ? WHERE id = ?").run(baseTime - 1, delivery.id);

      // Attempt 2: 503 again (reaches max_attempts = 2)
      (axios.post as any).mockResolvedValueOnce({ status: 503 });
      await processWebhookQueue();

      // Active delivery must be removed
      const active = db.prepare("SELECT * FROM webhook_deliveries WHERE id = ?").get(delivery.id);
      expect(active).toBeUndefined();

      // Dead letters must have exactly 1 record with no duplicates
      expect(countDeadLetters()).toBe(1);
      const deadLetter = db.prepare("SELECT * FROM webhook_dead_letters WHERE stream_id = ?").get("s1") as any;
      expect(deadLetter).toBeDefined();
      expect(deadLetter.event).toBe("stream.closed");
      expect(deadLetter.last_error).toBe("HTTP 503");
      expect(deadLetter.url).toBe("https://example.com/webhook");

      // Verify no remaining active deliveries
      expect(db.prepare("SELECT count(*) as count FROM webhook_deliveries").get()).toEqual({ count: 0 });
    });

    it("preserves delivery ID and failure reason deterministically when last permitted retry fails into dead-letter storage (SSB-2026-156)", async () => {
      const db = getDb();
      const baseTime = Math.floor(Date.now() / 1000);

      // Queue delivery with max_attempts = 1 (so initial attempt is also the last permitted retry)
      db.prepare(`
        INSERT INTO webhook_deliveries (stream_id, event, payload, attempt, max_attempts, status, next_retry_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run("s1", "stream.created", JSON.stringify({ stream_id: "s1" }), 0, 1, "pending", baseTime - 10, baseTime - 10);

      const delivery = db.prepare("SELECT * FROM webhook_deliveries WHERE stream_id = ?").get("s1") as any;
      const originalDeliveryId = delivery.id;

      // Axios fails on this last permitted retry with HTTP 500
      (axios.post as any).mockResolvedValueOnce({ status: 500 });
      await processWebhookQueue();

      // Active delivery must be removed from active deliveries
      const active = db.prepare("SELECT * FROM webhook_deliveries WHERE id = ?").get(originalDeliveryId);
      expect(active).toBeUndefined();

      // Exactly 1 dead letter row created
      expect(countDeadLetters()).toBe(1);
      const deadLetter = db.prepare("SELECT * FROM webhook_dead_letters WHERE stream_id = ?").get("s1") as any;
      expect(deadLetter).toBeDefined();
      expect(deadLetter.event).toBe("stream.created");
      expect(deadLetter.last_error).toBe("HTTP 500");
      expect(deadLetter.url).toBe("https://example.com/webhook");
      expect(deadLetter.payload).toBe(delivery.payload);
      expect(deadLetter.failed_at).toBeGreaterThanOrEqual(baseTime - 10);

      // Failure reason is deterministic and not silently altered
      expect(deadLetter.last_error).toBe("HTTP 500");
    });
  });
});

