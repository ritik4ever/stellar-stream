import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";

vi.mock("./metrics", () => ({
  eventsIndexedTotal: { inc: vi.fn() },
  ledgersScannedTotal: { inc: vi.fn() },
  lastIndexedLedger: { set: vi.fn() },
  indexerErrorsTotal: { inc: vi.fn() },
  indexerCircuitState: { set: vi.fn() },
}));

import { app } from "../index";
import { initDb, getDb } from "./db";
import { initCache, getCache } from "./cache";
import { getStreamHistory } from "./eventHistory";
import { getJwtSecret } from "./auth";
import path from "path";
import fs from "fs";

const TEST_DB_PATH = path.join(__dirname, "..", "..", "data", "test-mark-complete-streams.db");
const TEST_SECRET = "test_secret_for_mark_complete_integration";

describe("POST /api/streams/:id/mark-complete Integration Tests", () => {
  let authToken: string;
  let recipientToken: string;
  const mockSender = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
  const mockRecipient = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

  beforeAll(async () => {
    vi.stubEnv('JWT_SECRET', TEST_SECRET);
    process.env.DB_PATH = TEST_DB_PATH;
    initDb();
    initCache();

    authToken = jwt.sign({ accountId: mockSender }, getJwtSecret(), { expiresIn: '1h' });
    recipientToken = jwt.sign({ accountId: mockRecipient }, getJwtSecret(), { expiresIn: '1h' });
  });

  beforeEach(async () => {
    const db = getDb();
    db.exec("DELETE FROM stream_events");
    db.exec("DELETE FROM webhook_deliveries");
    db.exec("DELETE FROM streams");
    // Raw SQL cleanup bypasses the streamStore mutation paths that
    // normally invalidate the per-stream and list caches on write, so a
    // stale cached entry from a previous test can otherwise leak in here.
    await getCache().clear();
  });

  afterAll(() => {
    const db = getDb();
    db.close();

    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
  });

  it("should return 200 and mark a fully-vested stream as completed", async () => {
    const now = Math.floor(Date.now() / 1000);
    // A paused stream that was paused after running longer than its duration
    // is fully vested but not time-completed (status is "paused").
    const pausedStream = {
      id: "1",
      sender: mockSender,
      recipient: mockRecipient,
      asset_code: "USDC",
      total_amount: 1000,
      duration_seconds: 3600,
      start_at: now - 7200, // Started 2 hours ago
      created_at: now - 7200,
      paused_at: now - 1800, // Paused 30 min ago — elapsed > duration = fully vested
    };

    const db = getDb();
    db.prepare(`
      INSERT INTO streams (id, sender, recipient, asset_code, total_amount, duration_seconds, start_at, created_at, paused_at)
      VALUES (@id, @sender, @recipient, @asset_code, @total_amount, @duration_seconds, @start_at, @created_at, @paused_at)
    `).run(pausedStream);

    const response = await request(app)
      .post(`/api/streams/${pausedStream.id}/mark-complete`)
      .set("Authorization", `Bearer ${authToken}`);

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({
      id: pausedStream.id,
      sender: mockSender,
      recipient: mockRecipient,
      progress: {
        status: "completed",
      },
    });
    expect(response.body.data.completedAt).toBeDefined();
    expect(response.body.data.completedAt).toBeGreaterThanOrEqual(now);

    // Verify completed_at was set in SQLite
    const row = db.prepare("SELECT completed_at FROM streams WHERE id = ?").get(pausedStream.id) as any;
    expect(row.completed_at).toBe(response.body.data.completedAt);

    // Verify stream_completed event was recorded
    const history = getStreamHistory(pausedStream.id);
    const completedEvent = history.find(e => e.eventType === "completed");
    expect(completedEvent).toBeDefined();
    expect(completedEvent?.actor).toBe(mockSender);
  });

  it("should return 400 if stream is not fully vested", async () => {
    const now = Math.floor(Date.now() / 1000);
    const activeStream = {
      id: "2",
      sender: mockSender,
      recipient: mockRecipient,
      asset_code: "USDC",
      total_amount: 1000,
      duration_seconds: 36000, // 10 hours — only partially vested
      start_at: now - 1800, // Started 30 minutes ago
      created_at: now - 3600,
    };

    const db = getDb();
    db.prepare(`
      INSERT INTO streams (id, sender, recipient, asset_code, total_amount, duration_seconds, start_at, created_at)
      VALUES (@id, @sender, @recipient, @asset_code, @total_amount, @duration_seconds, @start_at, @created_at)
    `).run(activeStream);

    const response = await request(app)
      .post(`/api/streams/${activeStream.id}/mark-complete`)
      .set("Authorization", `Bearer ${authToken}`);

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("not fully vested");
  });

  it("should return 400 if stream is already completed", async () => {
    const now = Math.floor(Date.now() / 1000);
    const completedStream = {
      id: "3",
      sender: mockSender,
      recipient: mockRecipient,
      asset_code: "USDC",
      total_amount: 1000,
      duration_seconds: 3600,
      start_at: now - 7200,
      created_at: now - 7200,
      completed_at: now - 3600,
    };

    const db = getDb();
    db.prepare(`
      INSERT INTO streams (id, sender, recipient, asset_code, total_amount, duration_seconds, start_at, created_at, completed_at)
      VALUES (@id, @sender, @recipient, @asset_code, @total_amount, @duration_seconds, @start_at, @created_at, @completed_at)
    `).run(completedStream);

    const response = await request(app)
      .post(`/api/streams/${completedStream.id}/mark-complete`)
      .set("Authorization", `Bearer ${authToken}`);

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("already completed");
  });

  it("should return 400 if stream is already canceled", async () => {
    const now = Math.floor(Date.now() / 1000);
    const canceledStream = {
      id: "4",
      sender: mockSender,
      recipient: mockRecipient,
      asset_code: "USDC",
      total_amount: 1000,
      duration_seconds: 3600,
      start_at: now - 7200,
      created_at: now - 7200,
      canceled_at: now - 3600,
    };

    const db = getDb();
    db.prepare(`
      INSERT INTO streams (id, sender, recipient, asset_code, total_amount, duration_seconds, start_at, created_at, canceled_at)
      VALUES (@id, @sender, @recipient, @asset_code, @total_amount, @duration_seconds, @start_at, @created_at, @canceled_at)
    `).run(canceledStream);

    const response = await request(app)
      .post(`/api/streams/${canceledStream.id}/mark-complete`)
      .set("Authorization", `Bearer ${authToken}`);

    expect(response.status).toBe(400);
    expect(response.body.error).toContain("already canceled");
  });

  it("should return 403 when non-sender tries to mark stream complete", async () => {
    const now = Math.floor(Date.now() / 1000);
    const finishedStream = {
      id: "5",
      sender: mockSender,
      recipient: mockRecipient,
      asset_code: "USDC",
      total_amount: 1000,
      duration_seconds: 3600,
      start_at: now - 7200,
      created_at: now - 7200,
    };

    const db = getDb();
    db.prepare(`
      INSERT INTO streams (id, sender, recipient, asset_code, total_amount, duration_seconds, start_at, created_at)
      VALUES (@id, @sender, @recipient, @asset_code, @total_amount, @duration_seconds, @start_at, @created_at)
    `).run(finishedStream);

    const response = await request(app)
      .post(`/api/streams/${finishedStream.id}/mark-complete`)
      .set("Authorization", `Bearer ${recipientToken}`);

    expect(response.status).toBe(403);
    expect(response.body.code).toBe("FORBIDDEN");
  });

  it("should return 404 for non-existent stream", async () => {
    const response = await request(app)
      .post("/api/streams/999/mark-complete")
      .set("Authorization", `Bearer ${authToken}`);

    expect(response.status).toBe(404);
  });

  it("should return 401 when no auth token provided", async () => {
    const response = await request(app)
      .post("/api/streams/1/mark-complete");

    expect(response.status).toBe(401);
  });
});
