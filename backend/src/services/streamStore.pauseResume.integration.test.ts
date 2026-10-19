import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { app } from "../index";
import { initDb, getDb } from "./db";
import { getStreamHistory } from "./eventHistory";
import { getJwtSecret } from "./auth";
import path from "path";
import fs from "fs";

const TEST_DB_PATH = path.join(__dirname, "..", "..", "data", "test-pause-resume-streams.db");
const TEST_SECRET = "test_secret_for_pause_resume_integration";

describe("POST /api/streams/:id/pause and /api/streams/:id/resume Integration Tests", () => {
  let authToken: string;
  let recipientToken: string;
  const mockSender = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
  const mockRecipient = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

  beforeAll(async () => {
    vi.stubEnv('JWT_SECRET', TEST_SECRET);
    process.env.DB_PATH = TEST_DB_PATH;
    initDb();

    authToken = jwt.sign({ accountId: mockSender }, getJwtSecret(), { expiresIn: '1h' });
    recipientToken = jwt.sign({ accountId: mockRecipient }, getJwtSecret(), { expiresIn: '1h' });
  });

  beforeEach(() => {
    const db = getDb();
    db.exec("DELETE FROM stream_events");
    db.exec("DELETE FROM webhook_deliveries");
    db.exec("DELETE FROM streams");
  });

  afterAll(() => {
    const db = getDb();
    db.close();
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
  });

  function insertActiveStream(id: string, overrides: Record<string, any> = {}) {
    const now = Math.floor(Date.now() / 1000);
    const defaults: Record<string, any> = {
      id,
      sender: mockSender,
      recipient: mockRecipient,
      asset_code: "USDC",
      total_amount: 1000,
      duration_seconds: 3600,
      start_at: now - 1800,
      created_at: now - 3600,
    };
    const merged = { ...defaults, ...overrides };

    const db = getDb();
    db.prepare(`
      INSERT INTO streams (id, sender, recipient, asset_code, total_amount, duration_seconds, start_at, created_at, paused_at, paused_duration)
      VALUES (@id, @sender, @recipient, @asset_code, @total_amount, @duration_seconds, @start_at, @created_at, @paused_at, @paused_duration)
    `).run({
      paused_at: null,
      paused_duration: 0,
      ...merged,
    });
  }

  describe("Pause active stream", () => {
    it("should pause an active stream and return 200 with pausedAt set", async () => {
      insertActiveStream("1");

      const response = await request(app)
        .post("/api/streams/1/pause")
        .set("Authorization", `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data).toMatchObject({
        id: "1",
        sender: mockSender,
        recipient: mockRecipient,
        progress: {
          status: "paused",
        },
      });
      expect(response.body.data.pausedAt).toBeDefined();
      expect(response.body.data.pausedAt).toBeGreaterThanOrEqual(Math.floor(Date.now() / 1000) - 5);

      const history = getStreamHistory("1");
      const pausedEvent = history.find(e => e.eventType === "paused");
      expect(pausedEvent).toBeDefined();
      expect(pausedEvent?.actor).toBe(mockSender);
    });
  });

  describe("Resume paused stream", () => {
    it("should resume a paused stream and return 200 with pausedDuration updated", async () => {
      const now = Math.floor(Date.now() / 1000);
      insertActiveStream("2", { paused_at: now - 300 });

      const response = await request(app)
        .post("/api/streams/2/resume")
        .set("Authorization", `Bearer ${authToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data).toMatchObject({
        id: "2",
        sender: mockSender,
        recipient: mockRecipient,
        progress: {
          status: "active",
        },
      });
      expect(response.body.data.pausedAt).toBeUndefined();
      expect(response.body.data.pausedDuration).toBeGreaterThanOrEqual(300);

      const history = getStreamHistory("2");
      const resumedEvent = history.find(e => e.eventType === "resumed");
      expect(resumedEvent).toBeDefined();
      expect(resumedEvent?.actor).toBe(mockSender);
      expect(resumedEvent?.metadata?.pausedDuration).toBeGreaterThanOrEqual(300);
    });
  });

  describe("Pause already-paused stream", () => {
    it("should return 400 when trying to pause an already-paused stream", async () => {
      const now = Math.floor(Date.now() / 1000);
      insertActiveStream("3", { paused_at: now - 120 });

      const response = await request(app)
        .post("/api/streams/3/pause")
        .set("Authorization", `Bearer ${authToken}`);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("Only active streams can be paused.");
    });
  });

  describe("Resume non-paused stream", () => {
    it("should return 400 when trying to resume a non-paused stream", async () => {
      insertActiveStream("4");

      const response = await request(app)
        .post("/api/streams/4/resume")
        .set("Authorization", `Bearer ${authToken}`);

      expect(response.status).toBe(400);
      expect(response.body.error).toBe("Stream is not paused.");
    });
  });

  describe("Pause nonexistent stream", () => {
    it("should return 404 when pausing a nonexistent stream", async () => {
      const response = await request(app)
        .post("/api/streams/999/pause")
        .set("Authorization", `Bearer ${authToken}`);

      expect(response.status).toBe(404);
      expect(response.body.error).toBe("Stream not found.");
    });
  });

  describe("Resume nonexistent stream", () => {
    it("should return 404 when resuming a nonexistent stream", async () => {
      const response = await request(app)
        .post("/api/streams/999/resume")
        .set("Authorization", `Bearer ${authToken}`);

      expect(response.status).toBe(404);
      expect(response.body.error).toBe("Stream not found.");
    });
  });

  describe("Authorization - pause", () => {
    it("should return 403 when non-sender tries to pause stream", async () => {
      insertActiveStream("6");

      const response = await request(app)
        .post("/api/streams/6/pause")
        .set("Authorization", `Bearer ${recipientToken}`);

      expect(response.status).toBe(403);
      expect(response.body.error).toBe("Only the sender can pause this stream.");
    });

    it("should return 401 when no auth token provided", async () => {
      const response = await request(app)
        .post("/api/streams/1/pause");

      expect(response.status).toBe(401);
    });
  });

  describe("Authorization - resume", () => {
    it("should return 403 when non-sender tries to resume stream", async () => {
      const now = Math.floor(Date.now() / 1000);
      insertActiveStream("7", { paused_at: now - 120 });

      const response = await request(app)
        .post("/api/streams/7/resume")
        .set("Authorization", `Bearer ${recipientToken}`);

      expect(response.status).toBe(403);
      expect(response.body.error).toBe("Only the sender can resume this stream.");
    });

    it("should return 401 when no auth token provided", async () => {
      const response = await request(app)
        .post("/api/streams/1/resume");

      expect(response.status).toBe(401);
    });
  });

  describe("Event history verification", () => {
    it("should record pause and resume events in order", async () => {
      const now = Math.floor(Date.now() / 1000);
      insertActiveStream("8");

      // Pause
      const pauseRes = await request(app)
        .post("/api/streams/8/pause")
        .set("Authorization", `Bearer ${authToken}`);
      expect(pauseRes.status).toBe(200);

      let history = getStreamHistory("8");
      expect(history.filter(e => e.eventType === "paused")).toHaveLength(1);
      expect(history.filter(e => e.eventType === "resumed")).toHaveLength(0);

      // Resume
      const resumeRes = await request(app)
        .post("/api/streams/8/resume")
        .set("Authorization", `Bearer ${authToken}`);
      expect(resumeRes.status).toBe(200);

      history = getStreamHistory("8");
      expect(history.filter(e => e.eventType === "paused")).toHaveLength(1);
      expect(history.filter(e => e.eventType === "resumed")).toHaveLength(1);
      expect(history.map(e => e.eventType)).toEqual(["paused", "resumed"]);
    });
  });
});