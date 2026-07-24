import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { app } from "../index";
import { initDb, getDb } from "./db";
import { initCache } from "./cache";
import { getStreamHistory } from "./eventHistory";
import { getJwtSecret } from "./auth";
import path from "path";
import fs from "fs";
import { Keypair } from "@stellar/stellar-sdk";

// Use a separate test database
const TEST_DB_PATH = path.join(__dirname, "..", "..", "data", "test-transfer-streams.db");
const TEST_SECRET = "test_secret_for_transfer_integration";

describe("POST /api/streams/:id/transfer Integration Tests", () => {
  let authToken: string;
  let wrongSenderToken: string;
  const mockSender = Keypair.random().publicKey();
  const mockRecipient = Keypair.random().publicKey();
  const mockNewRecipient = Keypair.random().publicKey();
  const wrongSender = Keypair.random().publicKey();

  beforeAll(async () => {
    // Set test JWT secret
    vi.stubEnv('JWT_SECRET', TEST_SECRET);
    vi.stubEnv('CONTRACT_ID', '');
    
    // Set test database path
    process.env.DB_PATH = TEST_DB_PATH;
    
    // Initialize database
    initDb();
    initCache();

    // Create auth tokens for tests
    authToken = jwt.sign({ accountId: mockSender }, getJwtSecret(), { expiresIn: '1h' });
    wrongSenderToken = jwt.sign({ accountId: wrongSender }, getJwtSecret(), { expiresIn: '1h' });
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

  describe("Transfer active stream", () => {
    it("should transfer an active stream and return 200 with new recipient set", async () => {
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
        .post(`/api/streams/${activeStream.id}/transfer`)
        .set("Authorization", `Bearer ${authToken}`)
        .send({
          sender: mockSender,
          newRecipient: mockNewRecipient,
        });

      expect(response.status).toBe(200);
      expect(response.body.data).toMatchObject({
        id: activeStream.id,
        sender: mockSender,
        recipient: mockNewRecipient,
      });

      // Verify SQLite updated
      const updatedStream = db.prepare("SELECT recipient FROM streams WHERE id = ?").get(activeStream.id) as any;
      expect(updatedStream.recipient).toBe(mockNewRecipient);

      // Verify transferred event was recorded
      const history = getStreamHistory(activeStream.id);
      const transferredEvent = history.find(e => e.eventType === "stream_transferred");
      expect(transferredEvent).toBeDefined();
      expect(transferredEvent?.actor).toBe(mockSender);
      expect(transferredEvent?.metadata).toMatchObject({
        oldRecipient: mockRecipient,
        newRecipient: mockNewRecipient,
      });
    });
  });

  describe("Transfer failure cases", () => {
    it("should return 403 Forbidden for wrong sender", async () => {
      const now = Math.floor(Date.now() / 1000);
      const activeStream = {
        id: "2",
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
      `).run(activeStream);

      const response = await request(app)
        .post(`/api/streams/${activeStream.id}/transfer`)
        .set("Authorization", `Bearer ${wrongSenderToken}`)
        .send({
          sender: wrongSender,
          newRecipient: mockNewRecipient,
        });

      expect(response.status).toBe(403);
    });

    it("should return 400 Bad Request for non-active stream (completed stream)", async () => {
      const now = Math.floor(Date.now() / 1000);
      const completedStream = {
        id: "3",
        sender: mockSender,
        recipient: mockRecipient,
        asset_code: "USDC",
        total_amount: 1000,
        duration_seconds: 60,
        start_at: now - 100, // Completed 40s ago
        created_at: now - 200,
      };

      // Insert completed stream
      const db = getDb();
      db.prepare(`
        INSERT INTO streams (id, sender, recipient, asset_code, total_amount, duration_seconds, start_at, created_at)
        VALUES (@id, @sender, @recipient, @asset_code, @total_amount, @duration_seconds, @start_at, @created_at)
      `).run(completedStream);

      const response = await request(app)
        .post(`/api/streams/${completedStream.id}/transfer`)
        .set("Authorization", `Bearer ${authToken}`)
        .send({
          sender: mockSender,
          newRecipient: mockNewRecipient,
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain("Only active streams can be transferred");
    });

    it("should return 400 Bad Request for non-active stream (canceled stream)", async () => {
      const now = Math.floor(Date.now() / 1000);
      const canceledStream = {
        id: "4",
        sender: mockSender,
        recipient: mockRecipient,
        asset_code: "USDC",
        total_amount: 1000,
        duration_seconds: 3600,
        start_at: now - 1800,
        created_at: now - 3600,
        canceled_at: now - 900,
      };

      // Insert canceled stream
      const db = getDb();
      db.prepare(`
        INSERT INTO streams (id, sender, recipient, asset_code, total_amount, duration_seconds, start_at, created_at, canceled_at)
        VALUES (@id, @sender, @recipient, @asset_code, @total_amount, @duration_seconds, @start_at, @created_at, @canceled_at)
      `).run(canceledStream);

      const response = await request(app)
        .post(`/api/streams/${canceledStream.id}/transfer`)
        .set("Authorization", `Bearer ${authToken}`)
        .send({
          sender: mockSender,
          newRecipient: mockNewRecipient,
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain("Only active streams can be transferred");
    });
  });
});
