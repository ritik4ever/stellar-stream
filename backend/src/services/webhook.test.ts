import fs from "fs";
import path from "path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { logger } from "../logger";
import { initDb, getDb } from "./db";
import {
    clearDeadLetters,
    computeNextRetryState,
    countDeadLetters,
    pruneDeadLettersOlderThan,
    getDeadLetters,
    getRetryDelaySeconds,
    recordDeliveryFailure,
    recordDeliverySuccess,
    requeueDeadLetter,
    requeueDeadLetterWithState,
    triggerWebhook,
    validateWebhookUrl,
} from "./webhook";

const TEST_DB_PATH = path.join(__dirname, "..", "..", "data", "test-webhook.db");

describe("Webhook Retry Logic", () => {
    it("should return correct retry delays", () => {
        const expectedDelays = [5, 15, 60, 300, 900];

        expectedDelays.forEach((expectedDelay, index) => {
            const delay = getRetryDelaySeconds(index);
            expect(delay).toBe(expectedDelay);
        });
    });

    it("should return last delay for attempts beyond max", () => {
        const delay = getRetryDelaySeconds(10);
        expect(delay).toBe(900); // Last delay
    });

    it("should handle negative attempt numbers", () => {
        const delay = getRetryDelaySeconds(-1);
        expect(delay).toBe(900); // Last delay
    });

    it("should have correct sequence: 5s, 15s, 60s, 300s, 900s", () => {
        const delays = [0, 1, 2, 3, 4].map((i) => getRetryDelaySeconds(i));
        expect(delays).toEqual([5, 15, 60, 300, 900]);
    });

    it("computes consistent attempt count and next retry time across attempts", () => {
        const now = 1_700_000_000;

        // First failure (0 -> 1 of 3): 5s delay
        expect(computeNextRetryState(0, 3, now)).toEqual({
            status: "pending",
            attempt: 1,
            max_attempts: 3,
            delaySeconds: 5,
            next_retry_at: now + 5,
        });

        // Second failure (1 -> 2 of 3): 15s delay
        expect(computeNextRetryState(1, 3, now)).toEqual({
            status: "pending",
            attempt: 2,
            max_attempts: 3,
            delaySeconds: 15,
            next_retry_at: now + 15,
        });

        // Third failure (2 -> 3 of 3): dead-lettered, no next retry time
        expect(computeNextRetryState(2, 3, now)).toEqual({
            status: "dead_lettered",
            attempt: 3,
            max_attempts: 3,
            delaySeconds: null,
            next_retry_at: null,
        });
    });
});

describe("Webhook URL validation", () => {
    it("should accept valid https URLs", () => {
        expect(validateWebhookUrl("https://example.com/webhook").valid).toBe(true);
    });

    it("should reject private IP URLs", () => {
        const result = validateWebhookUrl("https://192.168.1.10/webhook");

        expect(result.valid).toBe(false);
        expect(result.reason).toContain("private");
    });

    it("should reject HTTP URLs", () => {
        const result = validateWebhookUrl("http://example.com/webhook");

        expect(result.valid).toBe(false);
        expect(result.reason).toContain("https");
    });

    it("should reject data URIs", () => {
        const result = validateWebhookUrl("data:text/plain,hello");

        expect(result.valid).toBe(false);
        expect(result.reason).toContain("https");
    });
});

describe("Webhook triggerWebhook and getDeadLetters", () => {
    let originalEnvUrl: string | undefined;

    beforeEach(() => {
        process.env.DB_PATH = TEST_DB_PATH;
        initDb();
        const db = getDb();
        db.exec("DELETE FROM stream_events");
        db.exec("DELETE FROM webhook_deliveries");
        db.exec("DELETE FROM webhook_dead_letters");
        db.exec("DELETE FROM streams");

        originalEnvUrl = process.env.WEBHOOK_DESTINATION_URL;
        process.env.WEBHOOK_DESTINATION_URL = "https://example.com/webhook";
        
        vi.spyOn(logger, "info").mockImplementation(() => logger);
        vi.spyOn(logger, "error").mockImplementation(() => logger);
    });

    afterEach(() => {
        const db = getDb();
        db.close();
        if (fs.existsSync(TEST_DB_PATH)) {
            fs.unlinkSync(TEST_DB_PATH);
        }
        process.env.WEBHOOK_DESTINATION_URL = originalEnvUrl;
        vi.restoreAllMocks();
    });

    it("should insert a row with status = 'pending' and attempt = 0 and return committed state", async () => {
        const db = getDb();
        db.prepare(`
            INSERT INTO streams (id, sender, recipient, asset_code, total_amount, duration_seconds, start_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run("stream-123", "sender", "recipient", "USDC", 100, 3600, 0, 0);

        const committed = await triggerWebhook("test_event", { stream_id: "stream-123", value: 100 });
        
        const row = db.prepare("SELECT * FROM webhook_deliveries WHERE stream_id = ?").get("stream-123") as any;
        
        expect(row).toBeDefined();
        expect(row.status).toBe("pending");
        expect(row.attempt).toBe(0);
        expect(row.event).toBe("test_event");
        expect(row.payload).toBe(JSON.stringify({ stream_id: "stream-123", value: 100 }));
        expect(row.max_attempts).toBe(5);
        expect(row.next_retry_at).toBe(row.created_at);
        expect(committed).toEqual(row);
    });

    it("should return null and not claim queued when DB insert fails", async () => {
        // Do not insert stream-missing so foreign key constraint fails
        const committed = await triggerWebhook("test_event", { stream_id: "stream-missing", value: 100 });

        expect(committed).toBeNull();
        const db = getDb();
        const count = db.prepare("SELECT count(*) as c FROM webhook_deliveries").get() as any;
        expect(count.c).toBe(0);
        expect(logger.info).not.toHaveBeenCalledWith(
            expect.anything(),
            "webhook delivery queued",
        );
    });

    it("should early return and log when WEBHOOK_DESTINATION_URL is missing", async () => {
        delete process.env.WEBHOOK_DESTINATION_URL;
        
        const committed = await triggerWebhook("test_event", { stream_id: "stream-123" });
        expect(committed).toBeNull();
        
        const db = getDb();
        const count = db.prepare("SELECT count(*) as c FROM webhook_deliveries").get() as any;
        
        expect(count.c).toBe(0);
        expect(logger.info).toHaveBeenCalledWith(
            { event: "test_event" },
            expect.stringContaining("destination URL is not set"),
        );
    });

    it("should early return when WEBHOOK_DESTINATION_URL is not allowed", async () => {
        process.env.WEBHOOK_DESTINATION_URL = "https://10.0.0.5/webhook";

        const committed = await triggerWebhook("test_event", { stream_id: "stream-123" });
        expect(committed).toBeNull();

        const db = getDb();
        const count = db.prepare("SELECT count(*) as c FROM webhook_deliveries").get() as any;

        expect(count.c).toBe(0);
        expect(logger.error).toHaveBeenCalledWith(
            expect.objectContaining({ reason: expect.stringContaining("private") }),
            expect.stringContaining("destination URL is invalid"),
        );
    });

    it("should early return and log error when stream_id is missing from data", async () => {
        const committed = await triggerWebhook("test_event", { some_other_id: "123" });
        expect(committed).toBeNull();
        
        const db = getDb();
        const count = db.prepare("SELECT count(*) as c FROM webhook_deliveries").get() as any;
        
        expect(count.c).toBe(0);
        expect(logger.error).toHaveBeenCalledWith(
            expect.objectContaining({ event: "test_event" }),
            expect.stringContaining("could not be mapped"),
        );
    });

    it("should return dead letters ordered by failed_at DESC", () => {
        const db = getDb();
        
        // Insert dummy dead letters out of order
        const stmt = db.prepare(`
            INSERT INTO webhook_dead_letters (stream_id, event, url, payload, last_error, failed_at)
            VALUES (?, ?, ?, ?, ?, ?)
        `);
        
        stmt.run("s1", "event.created", "http://u1", "p1", "err", 1000);
        stmt.run("s1", "event.created", "http://u2", "p2", "err", 3000);
        stmt.run("s1", "event.created", "http://u3", "p3", "err", 2000);
        
        const deadLetters = getDeadLetters();
        
        expect(deadLetters.length).toBe(3);
        // Descending order checks
        expect(deadLetters[0].url).toBe("http://u2"); // 3000
        expect(deadLetters[1].url).toBe("http://u3"); // 2000
        expect(deadLetters[2].url).toBe("http://u1"); // 1000
    });

    it("prunes only dead letters older than the cutoff", () => {
        const db = getDb();
        const stmt = db.prepare(`
            INSERT INTO webhook_dead_letters (stream_id, event, url, payload, failed_at)
            VALUES (?, ?, ?, ?, ?)
        `);
        stmt.run("old", "failed", "https://old.example", "{}", 999);
        stmt.run("boundary", "failed", "https://boundary.example", "{}", 1000);
        stmt.run("new", "failed", "https://new.example", "{}", 1001);

        expect(pruneDeadLettersOlderThan(1000)).toBe(1);
        expect(countDeadLetters()).toBe(2);
    });

    it("clears the entire dead-letter queue and reports the deleted count", () => {
        const db = getDb();
        const stmt = db.prepare(`
            INSERT INTO webhook_dead_letters (stream_id, event, url, payload, failed_at)
            VALUES (?, ?, ?, ?, ?)
        `);
        stmt.run("one", "failed", "https://one.example", "{}", 1000);
        stmt.run("two", "failed", "https://two.example", "{}", 2000);

        expect(clearDeadLetters()).toBe(2);
        expect(countDeadLetters()).toBe(0);
    });

    it("should requeue a dead letter back to the delivery queue", () => {
        const db = getDb();
        db.prepare(`
            INSERT INTO streams (id, sender, recipient, asset_code, total_amount, duration_seconds, start_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run("requeue-1", "sender", "recipient", "USDC", 100, 3600, 0, 0);

        const stmt = db.prepare(`
            INSERT INTO webhook_dead_letters (stream_id, event, url, payload, last_error, failed_at)
            VALUES (?, ?, ?, ?, ?, ?)
        `);
        stmt.run("requeue-1", "event.created", "https://example.com/webhook", '{"data":"test"}', "temporary failure", 123456);

        const deadLetters = getDeadLetters();
        expect(deadLetters.length).toBe(1);
        const deadLetter = deadLetters[0];

        expect(requeueDeadLetter(deadLetter.id)).toBe(true);

        const delivery = db.prepare("SELECT * FROM webhook_deliveries WHERE stream_id = ?").get("requeue-1") as any;
        expect(delivery).toBeDefined();
        expect(delivery.status).toBe("pending");
        expect(delivery.attempt).toBe(0);
        expect(delivery.max_attempts).toBe(5);
        expect(delivery.next_retry_at).toBe(delivery.created_at);
        expect(countDeadLetters()).toBe(0);
    });

    it("rolls back dead-letter requeue and does not claim change if delete fails", () => {
        const db = getDb();
        db.prepare(`
            INSERT INTO streams (id, sender, recipient, asset_code, total_amount, duration_seconds, start_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run("requeue-rollback", "sender", "recipient", "USDC", 100, 3600, 0, 0);

        const insertDead = db.prepare(`
            INSERT INTO webhook_dead_letters (stream_id, event, url, payload, last_error, failed_at)
            VALUES (?, ?, ?, ?, ?, ?)
        `).run("requeue-rollback", "event.created", "https://example.com/webhook", '{"data":"test"}', "timeout", 123456);
        const deadId = Number(insertDead.lastInsertRowid);

        db.exec(`
            CREATE TRIGGER abort_dead_letter_delete
            BEFORE DELETE ON webhook_dead_letters
            WHEN OLD.id = ${deadId}
            BEGIN
                SELECT RAISE(ABORT, 'forced dead letter delete failure');
            END;
        `);

        try {
            expect(() => requeueDeadLetterWithState(deadId)).toThrow("forced dead letter delete failure");
            expect(countDeadLetters()).toBe(1);
            const active = db.prepare("SELECT * FROM webhook_deliveries WHERE stream_id = ?").get("requeue-rollback");
            expect(active).toBeUndefined();
        } finally {
            db.exec("DROP TRIGGER IF EXISTS abort_dead_letter_delete");
        }
    });

    it("clears next_retry_at and error_message and increments attempt when recordDeliverySuccess commits", () => {
        const db = getDb();
        db.prepare(`
            INSERT INTO streams (id, sender, recipient, asset_code, total_amount, duration_seconds, start_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run("s-success", "sender", "recipient", "USDC", 100, 3600, 0, 0);

        const insertResult = db.prepare(`
            INSERT INTO webhook_deliveries (stream_id, event, payload, attempt, max_attempts, status, next_retry_at, created_at, last_attempt_at, error_message)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run("s-success", "event.created", "{}", 2, 5, "pending", 1005, 1000, 1000, "503 Service Unavailable");

        const deliveryId = Number(insertResult.lastInsertRowid);
        const result = recordDeliverySuccess(deliveryId, 1020);

        expect(result).toEqual({
            id: deliveryId,
            stream_id: "s-success",
            event: "event.created",
            status: "success",
            attempt: 3,
            max_attempts: 5,
            next_retry_at: null,
            last_attempt_at: 1020,
            error_message: null,
        });

        // Second call on already-succeeded delivery is a no-op and returns null
        expect(recordDeliverySuccess(deliveryId, 1030)).toBeNull();
        expect(recordDeliveryFailure(deliveryId, "https://example.com/webhook", "late timeout", 1030)).toBeNull();
    });
});