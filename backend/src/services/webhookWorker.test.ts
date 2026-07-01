import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import axios from "axios";
import { processWebhookQueue } from "./webhookWorker";
import { initDb, getDb } from "./db";
import { countDeadLetters } from "./webhook";
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
});
