import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { app } from "../index";
import { initDb, getDb } from "./db";
import { initCache, getCache } from "./cache";
import { getStreamHistory } from "./eventHistory";
import { getJwtSecret } from "./auth";
import path from "path";
import fs from "fs";

// Use a separate test database
const TEST_DB_PATH = path.join(__dirname, "..", "..", "data", "test-cancel-streams.db");
const TEST_SECRET = "test_secret_for_cancel_integration";

describe("POST /api/streams/:id/cancel Integration Tests", () => {
  let authToken: string;
  let recipientToken: string;
  const mockSender = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
  const mockRecipient = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

  beforeAll(async () => {
    // Set test JWT secret
    vi.stubEnv('JWT_SECRET', TEST_SECRET);
    
    // Set test database path
    process.env.DB_PATH = TEST_DB_PATH;
    
    // Initialize database
    initDb();
    initCache();

    // Create auth tokens for tests
    authToken = jwt.sign({ accountId: mockSender }, getJwtSecret(), { expiresIn: '1h' });
    recipientToken = jwt.sign({ accountId: mockRecipient }, getJwtSecret(), { expiresIn: '1h' });
  });

  beforeEach(async () => {
    // Clean database before each test
    const db = getDb();
    db.exec("DELETE FROM stream_events");
    db.exec("DELETE FROM webhook_deliveries");
    db.exec("DELETE FROM streams");
    // The GET /api/streams list endpoint caches responses by query string
    // with a TTL; raw SQL cleanup here bypasses the service-layer mutation
    // paths that normally invalidate that cache on write, so a stale
    // cached list from a previous test can otherwise leak into this one.
    await getCache().clear();
  });

  afterAll(() => {
    // Close database and clean up test file
    const db = getDb();
    db.close();
    
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
  });

  describe("Cancel active stream", () => {
    it("should cancel an active stream and return 200 with canceledAt set", async () => {
      const now = Math.floor(Date.now() / 1000);
      const activeStream = {
        id: "1",
        sender: mockSender,
        recipient: mockRecipient,
        asset_code: "USDC",
        total_amount: 1000,
        duration_seconds: 3600,
        start_at: now - 1800, // Started 30 minutes ago
        created_at: now - 3600,
      };

      // Insert active stream
      const db = getDb();
      db.prepare(`
        INSERT INTO streams (id, sender, recipient, asset_code, total_amount, duration_seconds, start_at, created_at)
        VALUES (@id, @sender, @recipient, @asset_code, @total_amount, @duration_seconds, @start_at, @created_at)
      `).run(activeStream);

      const response = await request(app)
        .post(`/api/streams/${activeStream.id}/cancel`)
        .set("Authorization", `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data).toMatchObject({
        id: activeStream.id,
        sender: mockSender,
        recipient: mockRecipient,
        progress: {
          status: "canceled"
        }
      });
      expect(response.body.data.canceledAt).toBeDefined();
      expect(response.body.data.canceledAt).toBeGreaterThanOrEqual(now);

      // Verify canceled event was recorded
      const history = getStreamHistory(activeStream.id);
      const canceledEvent = history.find(e => e.eventType === "canceled");
      expect(canceledEvent).toBeDefined();
      expect(canceledEvent?.actor).toBe(mockSender);
    });
  });

  describe("Cancel idempotency", () => {
    it("should return 200 when canceling an already-canceled stream (idempotent)", async () => {
      const now = Math.floor(Date.now() / 1000);
      const canceledStream = {
        id: "2",
        sender: mockSender,
        recipient: mockRecipient,
        asset_code: "USDC",
        total_amount: 1000,
        duration_seconds: 3600,
        start_at: now - 1800,
        created_at: now - 3600,
        canceled_at: now - 900, // Canceled 15 minutes ago
      };

      // Insert already-canceled stream
      const db = getDb();
      db.prepare(`
        INSERT INTO streams (id, sender, recipient, asset_code, total_amount, duration_seconds, start_at, created_at, canceled_at)
        VALUES (@id, @sender, @recipient, @asset_code, @total_amount, @duration_seconds, @start_at, @created_at, @canceled_at)
      `).run(canceledStream);

      // Record the original canceled event
      db.prepare(`
        INSERT INTO stream_events (stream_id, event_type, timestamp, actor)
        VALUES (?, 'canceled', ?, ?)
      `).run(canceledStream.id, canceledStream.canceled_at, mockSender);

      // First cancel request
      const response1 = await request(app)
        .post(`/api/streams/${canceledStream.id}/cancel`)
        .set("Authorization", `Bearer ${authToken}`);

      expect(response1.status).toBe(200);
      expect(response1.body.data.canceledAt).toBe(canceledStream.canceled_at);
      expect(response1.body.data.progress.status).toBe("canceled");

      // Second cancel request (idempotent)
      const response2 = await request(app)
        .post(`/api/streams/${canceledStream.id}/cancel`)
        .set("Authorization", `Bearer ${authToken}`);

      expect(response2.status).toBe(200);
      expect(response2.body.data.canceledAt).toBe(canceledStream.canceled_at);
      expect(response2.body.data.progress.status).toBe("canceled");

      // Verify only one canceled event exists
      const history = getStreamHistory(canceledStream.id);
      const canceledEvents = history.filter(e => e.eventType === "canceled");
      expect(canceledEvents).toHaveLength(1);
      expect(canceledEvents[0].timestamp).toBe(canceledStream.canceled_at);
    });
  });

  describe("Cancel nonexistent stream", () => {
    it("should return 404 when canceling a nonexistent stream", async () => {
      const response = await request(app)
        .post("/api/streams/999/cancel")
        .set("Authorization", `Bearer ${authToken}`);

      expect(response.status).toBe(404);
      expect(response.body.error).toBe("Stream not found.");
    });
  });

  describe("Cancel completed stream", () => {
    it("should return 200 and cancel a completed stream (sets canceledAt)", async () => {
      const now = Math.floor(Date.now() / 1000);
      const completedStream = {
        id: "3",
        sender: mockSender,
        recipient: mockRecipient,
        asset_code: "USDC",
        total_amount: 1000,
        duration_seconds: 3600,
        start_at: now - 7200, // Started 2 hours ago
        created_at: now - 10800,
        completed_at: now - 3600, // Completed 1 hour ago
      };

      // Insert completed stream
      const db = getDb();
      db.prepare(`
        INSERT INTO streams (id, sender, recipient, asset_code, total_amount, duration_seconds, start_at, created_at, completed_at)
        VALUES (@id, @sender, @recipient, @asset_code, @total_amount, @duration_seconds, @start_at, @created_at, @completed_at)
      `).run(completedStream);

      const response = await request(app)
        .post(`/api/streams/${completedStream.id}/cancel`)
        .set("Authorization", `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data).toMatchObject({
        id: completedStream.id,
        completedAt: completedStream.completed_at,
        progress: {
          status: "canceled" // Completed streams can be canceled, status becomes "canceled"
        }
      });
      expect(response.body.data.canceledAt).toBeDefined();

      // Verify canceled event was recorded for completed stream
      const history = getStreamHistory(completedStream.id);
      const canceledEvents = history.filter(e => e.eventType === "canceled");
      expect(canceledEvents).toHaveLength(1);
    });
  });

  describe("Authorization", () => {
    it("should return 403 when non-sender tries to cancel stream", async () => {
      const now = Math.floor(Date.now() / 1000);
      const stream = {
        id: "4",
        sender: mockSender,
        recipient: mockRecipient,
        asset_code: "USDC",
        total_amount: 1000,
        duration_seconds: 3600,
        start_at: now + 1800,
        created_at: now,
      };

      // Insert stream
      const db = getDb();
      db.prepare(`
        INSERT INTO streams (id, sender, recipient, asset_code, total_amount, duration_seconds, start_at, created_at)
        VALUES (@id, @sender, @recipient, @asset_code, @total_amount, @duration_seconds, @start_at, @created_at)
      `).run(stream);

      // Get auth token for different user (recipient) - already created in beforeAll
      const response = await request(app)
        .post(`/api/streams/${stream.id}/cancel`)
        .set("Authorization", `Bearer ${recipientToken}`);

      expect(response.status).toBe(403);
      expect(response.body.error).toBe("Only the sender can cancel this stream.");
    });

    it("should return 401 when no auth token provided", async () => {
      const response = await request(app)
        .post("/api/streams/1/cancel");

      expect(response.status).toBe(401);
    });
  });

  describe("Event history verification", () => {
    it("should record canceled event only on first cancel attempt", async () => {
      const now = Math.floor(Date.now() / 1000);
      const stream = {
        id: "5",
        sender: mockSender,
        recipient: mockRecipient,
        asset_code: "USDC",
        total_amount: 1000,
        duration_seconds: 3600,
        start_at: now - 1800,
        created_at: now - 3600,
      };

      // Insert active stream
      const db = getDb();
      db.prepare(`
        INSERT INTO streams (id, sender, recipient, asset_code, total_amount, duration_seconds, start_at, created_at)
        VALUES (@id, @sender, @recipient, @asset_code, @total_amount, @duration_seconds, @start_at, @created_at)
      `).run(stream);

      // First cancel - should record event
      await request(app)
        .post(`/api/streams/${stream.id}/cancel`)
        .set("Authorization", `Bearer ${authToken}`);

      let history = getStreamHistory(stream.id);
      let canceledEvents = history.filter(e => e.eventType === "canceled");
      expect(canceledEvents).toHaveLength(1);

      // Second cancel - should not record additional event
      await request(app)
        .post(`/api/streams/${stream.id}/cancel`)
        .set("Authorization", `Bearer ${authToken}`);

      history = getStreamHistory(stream.id);
      canceledEvents = history.filter(e => e.eventType === "canceled");
      expect(canceledEvents).toHaveLength(1); // Still only one event
    });
  });
});