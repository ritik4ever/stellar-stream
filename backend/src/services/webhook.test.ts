import fs from "fs";
import path from "path";
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { logger } from "../logger";
import { initDb, getDb } from "./db";
import {
    clearDeadLetters,
    countDeadLetters,
    pruneDeadLettersOlderThan,
    getDeadLetters,
    getRetryDelaySeconds,
    requeueDeadLetter,
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

    it("should insert a row with status = 'pending' and attempt = 0", async () => {
        const db = getDb();
        db.prepare(`
            INSERT INTO streams (id, sender, recipient, asset_code, total_amount, duration_seconds, start_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run("stream-123", "sender", "recipient", "USDC", 100, 3600, 0, 0);

        await triggerWebhook("test_event", { stream_id: "stream-123", value: 100 });
        
        const row = db.prepare("SELECT * FROM webhook_deliveries WHERE stream_id = ?").get("stream-123") as any;
        
        expect(row).toBeDefined();
        expect(row.status).toBe("pending");
        expect(row.attempt).toBe(0);
        expect(row.event).toBe("test_event");
        expect(row.payload).toBe(JSON.stringify({ stream_id: "stream-123", value: 100 }));
        expect(row.max_attempts).toBe(5);
    });

    it("should early return and log when WEBHOOK_DESTINATION_URL is missing", async () => {
        delete process.env.WEBHOOK_DESTINATION_URL;
        
        await triggerWebhook("test_event", { stream_id: "stream-123" });
        
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

        await triggerWebhook("test_event", { stream_id: "stream-123" });

        const db = getDb();
        const count = db.prepare("SELECT count(*) as c FROM webhook_deliveries").get() as any;

        expect(count.c).toBe(0);
        expect(logger.error).toHaveBeenCalledWith(
            expect.objectContaining({ reason: expect.stringContaining("private") }),
            expect.stringContaining("destination URL is invalid"),
        );
    });

    it("should early return and log error when stream_id is missing from data", async () => {
        await triggerWebhook("test_event", { some_other_id: "123" });
        
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
});
