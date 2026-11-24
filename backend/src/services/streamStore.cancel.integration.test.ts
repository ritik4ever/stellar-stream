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

/**
 * Holds the first cache invalidation of a cancel request so another request
 * can be interleaved deterministically, instead of relying on socket timing.
 */
function gateCacheInvalidation() {
  const cache = getCache() as any;
  const originalDel = cache.del.bind(cache);
  let releaseGate!: () => void;
  const gate = new Promise<void>((resolve) => { releaseGate = resolve; });
  let reached = false;
  const spy = vi.spyOn(cache, "del").mockImplementation(async (...args: unknown[]) => {
    if (!reached) {
      reached = true;
      await gate;
    }
    return originalDel(String(args[0]));
  });

  return {
    release: () => releaseGate(),
    isReached: () => reached,
    restore: () => spy.mockRestore(),
  };
}

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
    it("should return 409 without mutating a stream completed on-chain", async () => {
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

      expect(response.status).toBe(409);
      expect(response.body.error).toBe("Stream is already completed.");
      expect(response.body.code).toBe("ALREADY_COMPLETED");

      // Nothing moved: no canceled_at, no canceled event, no webhook.
      const row = db
        .prepare("SELECT canceled_at, completed_at FROM streams WHERE id = @id")
        .get({ id: completedStream.id }) as any;
      expect(row.canceled_at).toBeNull();
      expect(row.completed_at).toBe(completedStream.completed_at);

      const canceledEvents = getStreamHistory(completedStream.id).filter(
        e => e.eventType === "canceled",
      );
      expect(canceledEvents).toHaveLength(0);
    });

    it("should return 409 for a stream whose vesting period ended before completion was recorded", async () => {
      const now = Math.floor(Date.now() / 1000);
      const db = getDb();
      db.prepare(`
        INSERT INTO streams (id, sender, recipient, asset_code, total_amount, duration_seconds, start_at, created_at)
        VALUES (@id, @sender, @recipient, @asset_code, @total_amount, @duration_seconds, @start_at, @created_at)
      `).run({
        id: "6",
        sender: mockSender,
        recipient: mockRecipient,
        asset_code: "USDC",
        total_amount: 1000,
        duration_seconds: 3600,
        start_at: now - 7200, // Fully vested, completed_at not written yet
        created_at: now - 10800,
      });

      const response = await request(app)
        .post("/api/streams/6/cancel")
        .set("Authorization", `Bearer ${authToken}`);

      expect(response.status).toBe(409);
      expect(response.body.code).toBe("ALREADY_COMPLETED");

      const row = db.prepare("SELECT canceled_at FROM streams WHERE id = @id").get({ id: "6" }) as any;
      expect(row.canceled_at).toBeNull();
      expect(getStreamHistory("6").filter(e => e.eventType === "canceled")).toHaveLength(0);
    });
  });

  describe("Concurrent cancel requests", () => {
    it("should let exactly one request commit the cancel and its side effects", async () => {
      const now = Math.floor(Date.now() / 1000);
      const db = getDb();
      db.prepare(`
        INSERT INTO streams (id, sender, recipient, asset_code, total_amount, duration_seconds, start_at, created_at)
        VALUES (@id, @sender, @recipient, @asset_code, @total_amount, @duration_seconds, @start_at, @created_at)
      `).run({
        id: "7",
        sender: mockSender,
        recipient: mockRecipient,
        asset_code: "USDC",
        total_amount: 1000,
        duration_seconds: 3600,
        start_at: now - 1800,
        created_at: now - 3600,
      });

      // Hold the first request mid-flight, then send a second cancel before it
      // can commit: the classic duplicate-refund window.
      const gate = gateCacheInvalidation();
      try {
        const firstCancel = request(app)
          .post("/api/streams/7/cancel")
          .set("Authorization", `Bearer ${authToken}`)
          .then(r => r);

        for (let i = 0; i < 200 && !gate.isReached(); i++) {
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        expect(gate.isReached()).toBe(true);

        const secondCancel = await request(app)
          .post("/api/streams/7/cancel")
          .set("Authorization", `Bearer ${authToken}`);

        gate.release();
        const firstResponse = await firstCancel;

        // Every caller sees the same committed outcome: no 5xx, stable canceledAt.
        expect([firstResponse.status, secondCancel.status]).toEqual([200, 200]);
        expect(secondCancel.body.data.canceledAt).toBe(firstResponse.body.data.canceledAt);

        // Exactly one canceled event, no duplicate money-moving/stored effects.
        const canceledEvents = getStreamHistory("7").filter(e => e.eventType === "canceled");
        expect(canceledEvents).toHaveLength(1);

        const row = db
          .prepare("SELECT canceled_at FROM streams WHERE id = @id")
          .get({ id: "7" }) as any;
        expect(row.canceled_at).toBe(firstResponse.body.data.canceledAt);
      } finally {
        gate.release();
        gate.restore();
      }
    });
  });

  describe("Cancel racing with a claim", () => {
    it("should never record a claim larger than the amount vested at cancel time", async () => {
      const now = Math.floor(Date.now() / 1000);
      const db = getDb();
      db.prepare(`
        INSERT INTO streams (id, sender, recipient, asset_code, total_amount, duration_seconds, start_at, created_at)
        VALUES (@id, @sender, @recipient, @asset_code, @total_amount, @duration_seconds, @start_at, @created_at)
      `).run({
        id: "8",
        sender: mockSender,
        recipient: mockRecipient,
        asset_code: "USDC",
        total_amount: 1000,
        duration_seconds: 3600,
        start_at: now - 1800, // 500 vested, 500 still streaming
        created_at: now - 3600,
      });

      // Hold the cancel request mid-flight so a claim can slip into the race
      // window deterministically.
      const gate = gateCacheInvalidation();

      // Drift the wall clock while cancel is held; vesting keeps accruing.
      const realNow = Date.now.bind(Date);
      let clockOffsetMs = 0;
      const nowSpy = vi.spyOn(Date, "now").mockImplementation(() => realNow() + clockOffsetMs);

      try {
        const cancelPromise = request(app)
          .post("/api/streams/8/cancel")
          .set("Authorization", `Bearer ${authToken}`)
          .then(r => r);

        for (let i = 0; i < 200 && !gate.isReached(); i++) {
          await new Promise((resolve) => setTimeout(resolve, 5));
        }
        expect(gate.isReached()).toBe(true);

        clockOffsetMs = 600_000; // 10 minutes of extra vesting
        const claimResponse = await request(app)
          .post("/api/streams/8/claim")
          .set("Authorization", `Bearer ${recipientToken}`);

        gate.release();
        const cancelResponse = await cancelPromise;

        expect(claimResponse.status).toBe(200);
        expect(cancelResponse.status).toBe(200);

        const row = db
          .prepare("SELECT canceled_at, start_at, duration_seconds FROM streams WHERE id = @id")
          .get({ id: "8" }) as any;
        const vestedAtCancel = Math.min(
          1000,
          ((row.canceled_at - row.start_at) / row.duration_seconds) * 1000,
        );
        const claimed = db
          .prepare(
            "SELECT amount FROM stream_events WHERE stream_id = ? AND event_type = 'claimed'",
          )
          .all("8") as Array<{ amount: number }>;

        expect(claimed).toHaveLength(1);
        // Money-moving invariant: claimed amount + refund can never exceed total.
        expect(claimed[0].amount).toBeLessThanOrEqual(vestedAtCancel);
        expect(claimResponse.body.result.claimedAmount).toBeLessThanOrEqual(vestedAtCancel);

        // The cancel itself still happened once and only once.
        const canceledEvents = getStreamHistory("8").filter(e => e.eventType === "canceled");
        expect(canceledEvents).toHaveLength(1);
      } finally {
        gate.release();
        gate.restore();
        nowSpy.mockRestore();
      }
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