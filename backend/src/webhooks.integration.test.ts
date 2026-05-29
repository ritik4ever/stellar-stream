import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "./index";
import { initDb, getDb } from "./services/db";
import { getJwtSecret } from "./services/auth";
import jwt from "jsonwebtoken";
import path from "path";
import fs from "fs";
import { Keypair } from "@stellar/stellar-sdk";

// Use a separate test database for isolation
const TEST_DB_PATH = path.join(__dirname, "..", "data", "test-webhooks.db");

describe("Webhook Dead Letter Integration Tests", () => {
  let token: string;
  const testAccountId = Keypair.random().publicKey();

  beforeAll(() => {
    // Set test database path before initializing
    process.env.DB_PATH = TEST_DB_PATH;
    
    // Re-initialize database for this test file
    initDb();
    
    // Generate a valid JWT for authentication
    token = jwt.sign({ accountId: testAccountId }, getJwtSecret(), { expiresIn: '1h' });
  });

  beforeEach(() => {
    const db = getDb();
    db.exec("DELETE FROM webhook_dead_letters");
    db.exec("DELETE FROM webhook_deliveries");
    db.exec("DELETE FROM stream_events");
    db.exec("DELETE FROM streams");
  });

  afterAll(() => {
    const db = getDb();
    db.close();
    
    // Clean up test database file
    if (fs.existsSync(TEST_DB_PATH)) {
      try {
        fs.unlinkSync(TEST_DB_PATH);
      } catch (err) {
        console.error("Failed to delete test DB file:", err);
      }
    }
  });

  describe("GET /api/webhooks/dead-letters", () => {
    it("should return empty array when no dead letters exist", async () => {
      const response = await request(app)
        .get("/api/webhooks/dead-letters")
        .set("Authorization", `Bearer ${token}`);
      
      expect(response.status).toBe(200);
      expect(response.body.data).toEqual([]);
      expect(response.body.total).toBe(0);
    });

    it("should return dead letters with correct fields", async () => {
      const db = getDb();
      const now = Math.floor(Date.now() / 1000);
      
      // Insert parent stream to satisfy FK constraint
      db.prepare(`
        INSERT INTO streams (id, sender, recipient, asset_code, total_amount, duration_seconds, start_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run("s1", "sender", "recipient", "USDC", 100, 3600, 0, 0);

      db.prepare(`
        INSERT INTO webhook_dead_letters (stream_id, event, url, payload, last_error, failed_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run("s1", "stream.created", "http://example.com/webhook", '{"id":"s1"}', "Timeout", now);

      const response = await request(app)
        .get("/api/webhooks/dead-letters")
        .set("Authorization", `Bearer ${token}`);
      
      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(1);
      expect(response.body.data[0]).toMatchObject({
        stream_id: "s1",
        event: "stream.created",
        url: "http://example.com/webhook",
        payload: '{"id":"s1"}',
        last_error: "Timeout",
        failed_at: now
      });
    });

    it("should respect pagination (limit/offset)", async () => {
      const db = getDb();
      
      // Insert parent streams to satisfy FK constraint
      const streamStmt = db.prepare(`
        INSERT INTO streams (id, sender, recipient, asset_code, total_amount, duration_seconds, start_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      for (let i = 1; i <= 5; i++) {
        streamStmt.run(`s${i}`, "sender", "recipient", "USDC", 100, 3600, 0, 0);
      }

      for (let i = 1; i <= 5; i++) {
        db.prepare(`
          INSERT INTO webhook_dead_letters (stream_id, event, url, payload, last_error, failed_at)
          VALUES (?, ?, ?, ?, ?, ?)
        `).run(`s${i}`, "event", "url", "payload", "error", 1000 + i);
      }

      const response = await request(app)
        .get("/api/webhooks/dead-letters")
        .query({ page: 2, limit: 2 })
        .set("Authorization", `Bearer ${token}`);
      
      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(2);
      expect(response.body.total).toBe(5);
      expect(response.body.page).toBe(2);
      expect(response.body.limit).toBe(2);
      // SQLite returns ORDER BY failed_at DESC, so page 2 with limit 2 should be items 3 and 4 (indices 2 and 3)
      // failed_at: 1005, 1004 (page 1)
      // failed_at: 1003, 1002 (page 2)
      expect(response.body.data[0].stream_id).toBe("s3");
      expect(response.body.data[1].stream_id).toBe("s2");
    });
  });

  describe("GET /api/webhooks/dead-letters/count", () => {
    it("should return correct total count", async () => {
      const db = getDb();
      
      // Insert parent streams to satisfy FK constraint
      const streamStmt = db.prepare(`
        INSERT INTO streams (id, sender, recipient, asset_code, total_amount, duration_seconds, start_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `);
      streamStmt.run("s1", "sender", "recipient", "USDC", 100, 3600, 0, 0);
      streamStmt.run("s2", "sender", "recipient", "USDC", 100, 3600, 0, 0);

      db.prepare(`INSERT INTO webhook_dead_letters (stream_id, event, url, payload, last_error, failed_at) VALUES (?, ?, ?, ?, ?, ?)`).run("s1", "e", "u", "p", "err", 100);
      db.prepare(`INSERT INTO webhook_dead_letters (stream_id, event, url, payload, last_error, failed_at) VALUES (?, ?, ?, ?, ?, ?)`).run("s2", "e", "u", "p", "err", 100);

      const response = await request(app)
        .get("/api/webhooks/dead-letters/count")
        .set("Authorization", `Bearer ${token}`);
      
      expect(response.status).toBe(200);
      expect(response.body.total).toBe(2);
    });
  });

  describe("POST /api/webhooks/dead-letters/:id/requeue", () => {
    it("should re-queue a dead letter and remove it from dead letters table", async () => {
      const db = getDb();
      // Insert mock stream to satisfy foreign key constraint of webhook_deliveries
      db.prepare(`
        INSERT INTO streams (id, sender, recipient, asset_code, total_amount, duration_seconds, start_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run("s-requeue", "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF", "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB", "USDC", 100, 3600, 100, 100);

      db.prepare(`
        INSERT INTO webhook_dead_letters (stream_id, event, url, payload, last_error, failed_at)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run("s-requeue", "stream.created", "url", '{"id":"s-requeue"}', "err", 100);

      const deadLetter = db.prepare("SELECT id FROM webhook_dead_letters WHERE stream_id = ?").get("s-requeue") as any;
      
      const response = await request(app)
        .post(`/api/webhooks/dead-letters/${deadLetter.id}/requeue`)
        .set("Authorization", `Bearer ${token}`);
      
      expect(response.status).toBe(200);
      expect(response.body.success).toBe(true);

      // Verify it's moved
      const deadLetterCount = db.prepare("SELECT COUNT(*) as count FROM webhook_dead_letters").get() as any;
      expect(deadLetterCount.count).toBe(0);

      const delivery = db.prepare("SELECT * FROM webhook_deliveries WHERE stream_id = ?").get("s-requeue") as any;
      expect(delivery).toBeDefined();
      expect(delivery.event).toBe("stream.created");
      expect(delivery.status).toBe("pending");
      expect(delivery.attempt).toBe(0);
    });

    it("should return 404 for non-existent dead letter", async () => {
      const response = await request(app)
        .post("/api/webhooks/dead-letters/999/requeue")
        .set("Authorization", `Bearer ${token}`);
      
      expect(response.status).toBe(404);
    });
  });
});
