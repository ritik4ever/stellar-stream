import path from "path";
import fs from "fs";

// Use a separate test database
const TEST_DB_PATH = path.join(__dirname, "..", "..", "data", "test-bulk-cancel-streams.db");
const TEST_SECRET = "test_secret_for_bulk_cancel_integration";

// Set DB_PATH before importing db-dependent modules
process.env.DB_PATH = TEST_DB_PATH;

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { app } from "../index";
import { initDb, getDb } from "./db";
import { initCache } from "./cache";
import { getJwtSecret } from "./auth";

describe("POST /api/streams/bulk-cancel Integration Tests", () => {
  let authToken: string;
  const mockSender = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
  const mockRecipient = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

  beforeAll(async () => {
    // Set test JWT secret
    vi.stubEnv('JWT_SECRET', TEST_SECRET);
    
    // Initialize database (DB_PATH already set at module load time)
    initDb();
    initCache();

    // Create auth token for tests
    authToken = jwt.sign({ accountId: mockSender }, getJwtSecret(), { expiresIn: '1h' });
  });

  beforeEach(() => {
    // Clean database before each test
    const db = getDb();
    db.exec("DELETE FROM stream_events");
    db.exec("DELETE FROM webhook_deliveries");
    db.exec("DELETE FROM streams");
  });

  afterAll(() => {
    // Close database and clean up test file
    const db = getDb();
    db.close();
    
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
  });

  describe("Bulk cancel multiple streams", () => {
    it("should cancel 2 valid streams and report 1 invalid ID as failed", async () => {
      const now = Math.floor(Date.now() / 1000);
      
      const stream1 = {
        id: "1",
        sender: mockSender,
        recipient: mockRecipient,
        asset_code: "USDC",
        total_amount: 1000,
        duration_seconds: 3600,
        start_at: now - 1800,
        created_at: now - 3600,
      };

      const stream2 = {
        id: "2",
        sender: mockSender,
        recipient: mockRecipient,
        asset_code: "USDC",
        total_amount: 2000,
        duration_seconds: 3600,
        start_at: now - 1800,
        created_at: now - 3600,
      };

      const stream3 = {
        id: "3",
        sender: mockSender,
        recipient: mockRecipient,
        asset_code: "USDC",
        total_amount: 3000,
        duration_seconds: 3600,
        start_at: now - 1800,
        created_at: now - 3600,
      };

      // Insert 3 streams
      const db = getDb();
      const insert = db.prepare(`
        INSERT INTO streams (id, sender, recipient, asset_code, total_amount, duration_seconds, start_at, created_at)
        VALUES (@id, @sender, @recipient, @asset_code, @total_amount, @duration_seconds, @start_at, @created_at)
      `);
      insert.run(stream1);
      insert.run(stream2);
      insert.run(stream3);

      // Bulk cancel with 2 valid IDs and 1 invalid ID
      const response = await request(app)
        .post("/api/streams/bulk-cancel")
        .set("Authorization", `Bearer ${authToken}`)
        .send({
          streamIds: ["1", "2", "999"], // 999 is invalid
          sender: mockSender,
        });

      expect(response.status).toBe(200);
      expect(response.body.canceled).toEqual(["1", "2"]);
      expect(response.body.failed).toHaveLength(1);
      expect(response.body.failed[0]).toMatchObject({
        id: "999",
        error: "Stream not found",
      });

      // Verify streams 1 and 2 are canceled
      const canceledStream1 = db.prepare("SELECT * FROM streams WHERE id = @id").get({ id: "1" }) as any;
      const canceledStream2 = db.prepare("SELECT * FROM streams WHERE id = @id").get({ id: "2" }) as any;
      
      expect(canceledStream1.canceled_at).not.toBeNull();
      expect(canceledStream2.canceled_at).not.toBeNull();
      
      // Verify stream 3 is NOT canceled
      const notCanceledStream3 = db.prepare("SELECT * FROM streams WHERE id = @id").get({ id: "3" }) as any;
      expect(notCanceledStream3.canceled_at).toBeNull();
    });

    it("should return 400 when more than 20 stream IDs are provided", async () => {
      const streamIds = Array.from({ length: 21 }, (_, i) => (i + 1).toString());

      const response = await request(app)
        .post("/api/streams/bulk-cancel")
        .set("Authorization", `Bearer ${authToken}`)
        .send({
          streamIds,
          sender: mockSender,
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain("Maximum 20 stream IDs per request");
    });

    it("should return 400 when no stream IDs are provided", async () => {
      const response = await request(app)
        .post("/api/streams/bulk-cancel")
        .set("Authorization", `Bearer ${authToken}`)
        .send({
          streamIds: [],
          sender: mockSender,
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain("At least one stream ID is required");
    });

    it("should return 403 when sender in request body does not match authenticated user", async () => {
      const differentSender = "GDGMZTGMZTGMZTGMZTGMZTGMZTGMZTGMZTGMZTGMZTGMZTGMZTGMYPI2";

      const response = await request(app)
        .post("/api/streams/bulk-cancel")
        .set("Authorization", `Bearer ${authToken}`)
        .send({
          streamIds: ["1"],
          sender: differentSender,
        });

      expect(response.status).toBe(403);
      expect(response.body.error).toBe("Sender in request body does not match authenticated user.");
    });

    it("should return 401 when no auth token provided", async () => {
      const response = await request(app)
        .post("/api/streams/bulk-cancel")
        .send({
          streamIds: ["1"],
          sender: mockSender,
        });

      expect(response.status).toBe(401);
    });

    it("should report stream as failed when non-sender tries to cancel", async () => {
      const now = Math.floor(Date.now() / 1000);
      
      const otherSender = "GDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDDD";
      
      const stream1 = {
        id: "1",
        sender: otherSender, // Different sender
        recipient: mockRecipient,
        asset_code: "USDC",
        total_amount: 1000,
        duration_seconds: 3600,
        start_at: now - 1800,
        created_at: now - 3600,
      };

      const stream2 = {
        id: "2",
        sender: mockSender, // Same as authenticated user
        recipient: mockRecipient,
        asset_code: "USDC",
        total_amount: 2000,
        duration_seconds: 3600,
        start_at: now - 1800,
        created_at: now - 3600,
      };

      // Insert streams
      const db = getDb();
      const insert = db.prepare(`
        INSERT INTO streams (id, sender, recipient, asset_code, total_amount, duration_seconds, start_at, created_at)
        VALUES (@id, @sender, @recipient, @asset_code, @total_amount, @duration_seconds, @start_at, @created_at)
      `);
      insert.run(stream1);
      insert.run(stream2);

      const response = await request(app)
        .post("/api/streams/bulk-cancel")
        .set("Authorization", `Bearer ${authToken}`)
        .send({
          streamIds: ["1", "2"],
          sender: mockSender,
        });

      expect(response.status).toBe(200);
      expect(response.body.canceled).toEqual(["2"]);
      expect(response.body.failed).toHaveLength(1);
      expect(response.body.failed[0]).toMatchObject({
        id: "1",
        error: "Only the sender can cancel this stream",
      });
    });

    it("should cancel streams serially and handle errors gracefully", async () => {
      const now = Math.floor(Date.now() / 1000);
      
      const stream1 = {
        id: "1",
        sender: mockSender,
        recipient: mockRecipient,
        asset_code: "USDC",
        total_amount: 1000,
        duration_seconds: 3600,
        start_at: now - 1800,
        created_at: now - 3600,
      };

      const stream2 = {
        id: "2",
        sender: mockSender,
        recipient: mockRecipient,
        asset_code: "USDC",
        total_amount: 2000,
        duration_seconds: 3600,
        start_at: now - 1800,
        created_at: now - 3600,
      };

      // Insert streams
      const db = getDb();
      const insert = db.prepare(`
        INSERT INTO streams (id, sender, recipient, asset_code, total_amount, duration_seconds, start_at, created_at)
        VALUES (@id, @sender, @recipient, @asset_code, @total_amount, @duration_seconds, @start_at, @created_at)
      `);
      insert.run(stream1);
      insert.run(stream2);

      const response = await request(app)
        .post("/api/streams/bulk-cancel")
        .set("Authorization", `Bearer ${authToken}`)
        .send({
          streamIds: ["1", "2"],
          sender: mockSender,
        });

      expect(response.status).toBe(200);
      expect(response.body.canceled).toEqual(["1", "2"]);
      expect(response.body.failed).toHaveLength(0);

      // Verify both streams are canceled
      const canceledStream1 = db.prepare("SELECT * FROM streams WHERE id = ?").get("1") as any;
      const canceledStream2 = db.prepare("SELECT * FROM streams WHERE id = ?").get("2") as any;
      
      expect(canceledStream1.canceled_at).toBeDefined();
      expect(canceledStream2.canceled_at).toBeDefined();
    });
  });
});
