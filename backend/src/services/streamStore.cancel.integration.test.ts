import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { app } from "../index";
import { initDb, getDb } from "./db";
import { initCache } from "./cache";
import { getClaimedTotal, getStreamHistory } from "./eventHistory";
import { getJwtSecret } from "./auth";
import { cancelStream, pauseStream } from "./streamStore";
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

    it("handles repeated cancel on a completed stream idempotently without duplicate side effects (SSB-2026-100)", async () => {
      const now = Math.floor(Date.now() / 1000);
      const completedStream = {
        id: "1040",
        sender: mockSender,
        recipient: mockRecipient,
        asset_code: "USDC",
        total_amount: 1000,
        duration_seconds: 3600,
        start_at: now - 7200,
        created_at: now - 10800,
        completed_at: now - 3600,
      };

      const db = getDb();
      db.prepare(`
        INSERT INTO streams (id, sender, recipient, asset_code, total_amount, duration_seconds, start_at, created_at, completed_at)
        VALUES (@id, @sender, @recipient, @asset_code, @total_amount, @duration_seconds, @start_at, @created_at, @completed_at)
      `).run(completedStream);

      // First cancel
      const res1 = await request(app)
        .post(`/api/streams/${completedStream.id}/cancel`)
        .set("Authorization", `Bearer ${authToken}`);

      expect(res1.status).toBe(200);
      const initialCanceledAt = res1.body.data.canceledAt;
      expect(initialCanceledAt).toBeDefined();
      expect(res1.body.data.progress.status).toBe("canceled");
      // A fully vested stream refunds nothing, matching the contract settlement.
      expect(res1.body.data.refundedAmount).toBe(0);

      // Repeated cancel on completed stream
      const res2 = await request(app)
        .post(`/api/streams/${completedStream.id}/cancel`)
        .set("Authorization", `Bearer ${authToken}`);

      expect(res2.status).toBe(200);
      expect(res2.body.data.canceledAt).toBe(initialCanceledAt);
      expect(res2.body.data.completedAt).toBe(completedStream.completed_at);
      expect(res2.body.data.progress.status).toBe("canceled");
      expect(res2.body.data.refundedAmount).toBe(0);

      // Stored record verification
      const stored = db.prepare("SELECT canceled_at, completed_at, refunded_amount FROM streams WHERE id = ?").get(completedStream.id);
      expect(stored.canceled_at).toBe(initialCanceledAt);
      expect(stored.completed_at).toBe(completedStream.completed_at);
      expect(stored.refunded_amount).toBe(0);

      // Verify no duplicate events or side effects
      const history = getStreamHistory(completedStream.id);
      const canceledEvents = history.filter(e => e.eventType === "canceled");
      expect(canceledEvents).toHaveLength(1);
    });
  });

  describe("Cancel racing with a claim (SSB-2026-100)", () => {
    it("preserves atomic stream state, refund calculations, and absence of duplicate side effects when cancel races with a claim", async () => {
      const now = Math.floor(Date.now() / 1000);
      const racingStream = {
        id: "1041",
        sender: mockSender,
        recipient: mockRecipient,
        asset_code: "USDC",
        total_amount: 1000,
        duration_seconds: 3600,
        start_at: now - 1800,
        created_at: now - 3600,
      };

      const db = getDb();
      db.prepare(`
        INSERT INTO streams (id, sender, recipient, asset_code, total_amount, duration_seconds, start_at, created_at)
        VALUES (@id, @sender, @recipient, @asset_code, @total_amount, @duration_seconds, @start_at, @created_at)
      `).run(racingStream);

      // Simulate a partial recipient claim committed right before cancel resolves.
      // Claimed totals live in the event log; there is no claimed_amount column.
      const claimedAmount = 400;
      db.prepare(`
        INSERT INTO stream_events (stream_id, event_type, timestamp, actor, amount)
        VALUES (?, 'claimed', ?, ?, ?)
      `).run(racingStream.id, now - 100, mockRecipient, claimedAmount);

      // Execute cancel
      const response = await request(app)
        .post(`/api/streams/${racingStream.id}/cancel`)
        .set("Authorization", `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data.progress.status).toBe("canceled");
      // The claim event is preserved and still the only source of claimed totals.
      expect(getClaimedTotal(racingStream.id)).toBe(claimedAmount);

      // Final stored state verification — the response must mirror the commit.
      const stored = db.prepare("SELECT canceled_at, refunded_amount, total_amount FROM streams WHERE id = ?").get(racingStream.id);
      expect(stored.canceled_at).not.toBeNull();
      expect(stored.canceled_at).toBe(response.body.data.canceledAt);
      expect(stored.refunded_amount).toBe(response.body.data.refundedAmount);

      // Refund calculation: total_amount - vested at cancel timestamp,
      // matching the contract's settle_cancel rule.
      expect(stored.refunded_amount).toBeGreaterThan(0);
      expect(
        stored.refunded_amount + response.body.data.progress.vestedAmount,
      ).toBeCloseTo(stored.total_amount, 3);

      // Verify exactly one canceled event exists and event order is preserved
      const history = getStreamHistory(racingStream.id);
      const canceledEvents = history.filter(e => e.eventType === "canceled");
      const claimEvents = history.filter(e => e.eventType === "claimed");
      expect(canceledEvents).toHaveLength(1);
      expect(claimEvents).toHaveLength(1);

      // Subsequent cancel attempts should remain idempotent
      const retryResponse = await request(app)
        .post(`/api/streams/${racingStream.id}/cancel`)
        .set("Authorization", `Bearer ${authToken}`);

      expect(retryResponse.status).toBe(200);
      expect(retryResponse.body.data.canceledAt).toBe(stored.canceled_at);
      expect(retryResponse.body.data.refundedAmount).toBe(stored.refunded_amount);
      expect(getStreamHistory(racingStream.id).filter(e => e.eventType === "canceled")).toHaveLength(1);
    });
  });

  describe("Committed-state consistency (SSB-2026-098 / #1040)", () => {
    it("returns the committed record that a subsequent read observes", async () => {
      const now = Math.floor(Date.now() / 1000);
      const stream = {
        id: "1044",
        sender: mockSender,
        recipient: mockRecipient,
        asset_code: "USDC",
        total_amount: 1000,
        duration_seconds: 3600,
        start_at: now - 1800,
        created_at: now - 3600,
      };
      const db = getDb();
      db.prepare(`
        INSERT INTO streams (id, sender, recipient, asset_code, total_amount, duration_seconds, start_at, created_at)
        VALUES (@id, @sender, @recipient, @asset_code, @total_amount, @duration_seconds, @start_at, @created_at)
      `).run(stream);

      const cancelResponse = await request(app)
        .post(`/api/streams/${stream.id}/cancel`)
        .set("Authorization", `Bearer ${authToken}`);

      expect(cancelResponse.status).toBe(200);

      const readResponse = await request(app).get(`/api/streams/${stream.id}`);
      expect(readResponse.status).toBe(200);

      // The mutation response and the next read must agree on every committed field.
      expect(readResponse.body.data).toMatchObject({
        id: stream.id,
        canceledAt: cancelResponse.body.data.canceledAt,
        refundedAmount: cancelResponse.body.data.refundedAmount,
        progress: cancelResponse.body.data.progress,
      });

      // Refund and vested amount partition the stream total.
      expect(
        cancelResponse.body.data.refundedAmount +
          cancelResponse.body.data.progress.vestedAmount,
      ).toBeCloseTo(stream.total_amount, 3);
    });

    it("commits exactly one cancellation when duplicate requests race", async () => {
      const now = Math.floor(Date.now() / 1000);
      const stream = {
        id: "1045",
        sender: mockSender,
        recipient: mockRecipient,
        asset_code: "USDC",
        total_amount: 1000,
        duration_seconds: 3600,
        start_at: now - 1800,
        created_at: now - 3600,
      };
      const db = getDb();
      db.prepare(`
        INSERT INTO streams (id, sender, recipient, asset_code, total_amount, duration_seconds, start_at, created_at)
        VALUES (@id, @sender, @recipient, @asset_code, @total_amount, @duration_seconds, @start_at, @created_at)
      `).run(stream);

      const [first, second] = await Promise.all([
        request(app)
          .post(`/api/streams/${stream.id}/cancel`)
          .set("Authorization", `Bearer ${authToken}`),
        request(app)
          .post(`/api/streams/${stream.id}/cancel`)
          .set("Authorization", `Bearer ${authToken}`),
      ]);

      expect(first.status).toBe(200);
      expect(second.status).toBe(200);
      expect(second.body.data.canceledAt).toBe(first.body.data.canceledAt);
      expect(second.body.data.refundedAmount).toBe(first.body.data.refundedAmount);

      const stored = db
        .prepare("SELECT canceled_at, refunded_amount FROM streams WHERE id = ?")
        .get(stream.id);
      expect(stored.canceled_at).toBe(first.body.data.canceledAt);
      expect(stored.refunded_amount).toBe(first.body.data.refundedAmount);
      expect(
        getStreamHistory(stream.id).filter((event) => event.eventType === "canceled"),
      ).toHaveLength(1);
    });

    it("treats a fully claimed stream as completed and refunds nothing", async () => {
      const now = Math.floor(Date.now() / 1000);
      const stream = {
        id: "1046",
        sender: mockSender,
        recipient: mockRecipient,
        asset_code: "USDC",
        total_amount: 1000,
        duration_seconds: 3600,
        start_at: now - 3600,
        created_at: now - 7200,
      };
      const db = getDb();
      db.prepare(`
        INSERT INTO streams (id, sender, recipient, asset_code, total_amount, duration_seconds, start_at, created_at)
        VALUES (@id, @sender, @recipient, @asset_code, @total_amount, @duration_seconds, @start_at, @created_at)
      `).run(stream);
      db.prepare(`
        INSERT INTO stream_events (stream_id, event_type, timestamp, actor, amount)
        VALUES (?, 'claimed', ?, ?, ?)
      `).run(stream.id, now - 100, mockRecipient, stream.total_amount);

      const response = await request(app)
        .post(`/api/streams/${stream.id}/cancel`)
        .set("Authorization", `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data.refundedAmount).toBe(0);
      expect(response.body.data.progress.status).toBe("canceled");
      expect(getClaimedTotal(stream.id)).toBe(stream.total_amount);
      expect(
        getStreamHistory(stream.id).filter((event) => event.eventType === "claimed"),
      ).toHaveLength(1);
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
    it("returns a stable error and rolls back the stream update when event insertion fails", async () => {
      const now = Math.floor(Date.now() / 1000);
      const stream = {
        id: "1042",
        sender: mockSender,
        recipient: mockRecipient,
        asset_code: "USDC",
        total_amount: 1000,
        duration_seconds: 3600,
        start_at: now - 1800,
        created_at: now - 3600,
      };
      const db = getDb();
      db.prepare(`
        INSERT INTO streams (id, sender, recipient, asset_code, total_amount, duration_seconds, start_at, created_at)
        VALUES (@id, @sender, @recipient, @asset_code, @total_amount, @duration_seconds, @start_at, @created_at)
      `).run(stream);
      db.exec(`
        CREATE TRIGGER fail_canceled_event
        BEFORE INSERT ON stream_events
        WHEN NEW.stream_id = '${stream.id}' AND NEW.event_type = 'canceled'
        BEGIN
          SELECT RAISE(ABORT, 'forced event insert failure');
        END;
      `);

      try {
        const response = await request(app)
          .post(`/api/streams/${stream.id}/cancel`)
          .set("Authorization", `Bearer ${authToken}`);

        expect(response.status).toBe(500);
        expect(response.body).toMatchObject({
          error: "Failed to persist stream and event.",
          code: "STREAM_WRITE_FAILED",
        });
        expect(
          db.prepare("SELECT canceled_at FROM streams WHERE id = ?").get(stream.id)
            .canceled_at,
        ).toBeNull();
        expect(
          db.prepare("SELECT refunded_amount FROM streams WHERE id = ?").get(stream.id)
            .refunded_amount,
        ).toBeNull();
        expect(getStreamHistory(stream.id)).toHaveLength(0);
      } finally {
        db.exec("DROP TRIGGER IF EXISTS fail_canceled_event");
      }
    });

    it("preserves both updates and history when two writers update the same stream", async () => {
      const now = Math.floor(Date.now() / 1000);
      const stream = {
        id: "1043",
        sender: mockSender,
        recipient: mockRecipient,
        asset_code: "USDC",
        total_amount: 1000,
        duration_seconds: 3600,
        start_at: now - 1800,
        created_at: now - 3600,
      };
      const db = getDb();
      db.prepare(`
        INSERT INTO streams (id, sender, recipient, asset_code, total_amount, duration_seconds, start_at, created_at)
        VALUES (@id, @sender, @recipient, @asset_code, @total_amount, @duration_seconds, @start_at, @created_at)
      `).run(stream);

      const previousSorobanDisabled = process.env.SOROBAN_DISABLED;
      const previousContractId = process.env.CONTRACT_ID;
      process.env.SOROBAN_DISABLED = "true";
      delete process.env.CONTRACT_ID;
      try {
        const results = await Promise.all([
          pauseStream(stream.id),
          cancelStream(stream.id),
        ]);

        expect(results).toHaveLength(2);
        const updated = db
          .prepare("SELECT paused_at, canceled_at FROM streams WHERE id = ?")
          .get(stream.id);
        expect(updated.paused_at).not.toBeNull();
        expect(updated.canceled_at).not.toBeNull();
        expect(getStreamHistory(stream.id).map((event) => event.eventType).sort()).toEqual([
          "canceled",
          "paused",
        ]);
      } finally {
        if (previousSorobanDisabled === undefined) {
          delete process.env.SOROBAN_DISABLED;
        } else {
          process.env.SOROBAN_DISABLED = previousSorobanDisabled;
        }
        if (previousContractId === undefined) {
          delete process.env.CONTRACT_ID;
        } else {
          process.env.CONTRACT_ID = previousContractId;
        }
      }
    });

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