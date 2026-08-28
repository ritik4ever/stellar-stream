import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { app } from "../index";
import { initDb, getDb } from "./db";
import { getJwtSecret } from "./auth";
import path from "path";
import fs from "fs";

// Use a separate test database
const TEST_DB_PATH = path.join(__dirname, "..", "..", "data", "test-notes-streams.db");
const TEST_SECRET = "test_secret_for_notes_integration";

describe("Stream Notes Integration Tests", () => {
  let senderToken: string;
  let recipientToken: string;
  const mockSender = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
  const mockRecipient = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";
  const now = Math.floor(Date.now() / 1000);

  beforeAll(async () => {
    vi.stubEnv("JWT_SECRET", TEST_SECRET);
    process.env.DB_PATH = TEST_DB_PATH;
    initDb();

    senderToken = jwt.sign({ accountId: mockSender }, getJwtSecret(), { expiresIn: "1h" });
    recipientToken = jwt.sign({ accountId: mockRecipient }, getJwtSecret(), { expiresIn: "1h" });
  });

  beforeEach(() => {
    const db = getDb();
    db.exec("DELETE FROM stream_notes");
    db.exec("DELETE FROM stream_events");
    db.exec("DELETE FROM webhook_deliveries");
    db.exec("DELETE FROM streams");

    db.prepare(`
      INSERT INTO streams (id, sender, recipient, asset_code, total_amount, duration_seconds, start_at, created_at)
      VALUES (@id, @sender, @recipient, @asset_code, @total_amount, @duration_seconds, @start_at, @created_at)
    `).run({
      id: "1",
      sender: mockSender,
      recipient: mockRecipient,
      asset_code: "USDC",
      total_amount: 1000,
      duration_seconds: 3600,
      start_at: now - 1800,
      created_at: now - 3600,
    });
  });

  afterAll(() => {
    const db = getDb();
    db.close();
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
  });

  describe("POST /api/streams/:id/notes", () => {
    it("allows the sender to add a note", async () => {
      const response = await request(app)
        .post("/api/streams/1/notes")
        .set("Authorization", `Bearer ${senderToken}`)
        .send({ content: "Milestone review pending." });

      expect(response.status).toBe(201);
      expect(response.body.data).toMatchObject({
        streamId: "1",
        author: mockSender,
        content: "Milestone review pending.",
      });
      expect(response.body.data.createdAt).toBeDefined();
    });

    it("returns 403 when the recipient tries to add a note", async () => {
      const response = await request(app)
        .post("/api/streams/1/notes")
        .set("Authorization", `Bearer ${recipientToken}`)
        .send({ content: "Not allowed." });

      expect(response.status).toBe(403);
    });

    it("returns 404 for a nonexistent stream", async () => {
      const response = await request(app)
        .post("/api/streams/999/notes")
        .set("Authorization", `Bearer ${senderToken}`)
        .send({ content: "Missing stream." });

      expect(response.status).toBe(404);
    });

    it("returns 400 when content exceeds 500 characters", async () => {
      const response = await request(app)
        .post("/api/streams/1/notes")
        .set("Authorization", `Bearer ${senderToken}`)
        .send({ content: "a".repeat(501) });

      expect(response.status).toBe(400);
    });

    it("returns 401 when unauthenticated", async () => {
      const response = await request(app)
        .post("/api/streams/1/notes")
        .send({ content: "No token." });

      expect(response.status).toBe(401);
    });
  });

  describe("GET /api/streams/:id/notes", () => {
    it("allows the sender to read notes, newest first", async () => {
      await request(app)
        .post("/api/streams/1/notes")
        .set("Authorization", `Bearer ${senderToken}`)
        .send({ content: "First note." });
      await request(app)
        .post("/api/streams/1/notes")
        .set("Authorization", `Bearer ${senderToken}`)
        .send({ content: "Second note." });

      const response = await request(app)
        .get("/api/streams/1/notes")
        .set("Authorization", `Bearer ${senderToken}`);

      expect(response.status).toBe(200);
      expect(response.body.total).toBe(2);
      expect(response.body.data[0].content).toBe("Second note.");
      expect(response.body.data[1].content).toBe("First note.");
    });

    it("returns 403 when the recipient tries to read notes", async () => {
      const response = await request(app)
        .get("/api/streams/1/notes")
        .set("Authorization", `Bearer ${recipientToken}`);

      expect(response.status).toBe(403);
    });

    it("paginates results", async () => {
      for (let i = 0; i < 3; i++) {
        await request(app)
          .post("/api/streams/1/notes")
          .set("Authorization", `Bearer ${senderToken}`)
          .send({ content: `Note ${i}` });
      }

      const response = await request(app)
        .get("/api/streams/1/notes?page=1&limit=2")
        .set("Authorization", `Bearer ${senderToken}`);

      expect(response.status).toBe(200);
      expect(response.body.data).toHaveLength(2);
      expect(response.body.total).toBe(3);
      expect(response.body.page).toBe(1);
      expect(response.body.limit).toBe(2);
    });
  });
});
