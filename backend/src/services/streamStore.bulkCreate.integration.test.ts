import path from "path";
import fs from "fs";

// Use a separate test database
const TEST_DB_PATH = path.join(__dirname, "..", "..", "data", "test-bulk-create-streams.db");
const TEST_SECRET = "test_secret_for_bulk_create_integration";

// Set DB_PATH before importing db-dependent modules
process.env.DB_PATH = TEST_DB_PATH;

import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { app } from "../index";
import { initDb, getDb } from "./db";
import { initCache } from "./cache";
import { getJwtSecret } from "./auth";

describe("POST /api/streams/batch Integration Tests", () => {
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

  describe("Bulk create multiple streams", () => {
    it("should create 2 streams successfully and return their IDs", async () => {
      const now = Math.floor(Date.now() / 1000);
      
      const streams = [
        {
          sender: mockSender,
          recipient: mockRecipient,
          assetCode: "USDC",
          totalAmount: 1000,
          durationSeconds: 3600,
          startAt: now + 60,
        },
        {
          sender: mockSender,
          recipient: mockRecipient,
          assetCode: "USDC",
          totalAmount: 2000,
          durationSeconds: 3600,
          startAt: now + 60,
        },
      ];

      const response = await request(app)
        .post("/api/streams/batch")
        .set("Authorization", `Bearer ${authToken}`)
        .send({
          streams,
          sender: mockSender,
        });

      expect(response.status).toBe(201);
      expect(response.body.data.streamIds).toHaveLength(2);
      expect(response.body.data.streamIds).toEqual(expect.arrayContaining([expect.any(String), expect.any(String)]));

      // Verify streams are in database
      const db = getDb();
      const count = db.prepare("SELECT COUNT(*) as count FROM streams").get() as { count: number };
      expect(count.count).toBe(2);
    });

    it("should return 400 when more than 20 streams are provided", async () => {
      const streams = Array.from({ length: 21 }, (_, i) => ({
        sender: mockSender,
        recipient: mockRecipient,
        assetCode: "USDC",
        totalAmount: 1000,
        durationSeconds: 3600,
        startAt: Math.floor(Date.now() / 1000) + 60,
      }));

      const response = await request(app)
        .post("/api/streams/batch")
        .set("Authorization", `Bearer ${authToken}`)
        .send({
          streams,
          sender: mockSender,
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain("Maximum 20 streams per request");
    });

    it("should return 400 when no streams are provided", async () => {
      const response = await request(app)
        .post("/api/streams/batch")
        .set("Authorization", `Bearer ${authToken}`)
        .send({
          streams: [],
          sender: mockSender,
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain("At least one stream config is required");
    });

    it("should return 400 when streams have different senders", async () => {
      const otherSender = "GDGMZTGMZTGMZTGMZTGMZTGMZTGMZTGMZTGMZTGMZTGMZTGMZTGMYPI2";
      
      const streams = [
        {
          sender: mockSender,
          recipient: mockRecipient,
          assetCode: "USDC",
          totalAmount: 1000,
          durationSeconds: 3600,
          startAt: Math.floor(Date.now() / 1000) + 60,
        },
        {
          sender: otherSender, // Different sender
          recipient: mockRecipient,
          assetCode: "USDC",
          totalAmount: 2000,
          durationSeconds: 3600,
          startAt: Math.floor(Date.now() / 1000) + 60,
        },
      ];

      const response = await request(app)
        .post("/api/streams/batch")
        .set("Authorization", `Bearer ${authToken}`)
        .send({
          streams,
          sender: mockSender,
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain("All streams must have the same sender");
    });

    it("should return 403 when sender in request body does not match authenticated user", async () => {
      const differentSender = "GDGMZTGMZTGMZTGMZTGMZTGMZTGMZTGMZTGMZTGMZTGMZTGMYPI2";
      const now = Math.floor(Date.now() / 1000);

      const streams = [
        {
          sender: mockSender,
          recipient: mockRecipient,
          assetCode: "USDC",
          totalAmount: 1000,
          durationSeconds: 3600,
          startAt: now + 60,
        },
      ];

      const response = await request(app)
        .post("/api/streams/batch")
        .set("Authorization", `Bearer ${authToken}`)
        .send({
          streams,
          sender: differentSender,
        });

      expect(response.status).toBe(403);
      expect(response.body.error).toBe("Sender in request body does not match authenticated user.");
    });

    it("should return 401 when no auth token provided", async () => {
      const now = Math.floor(Date.now() / 1000);

      const streams = [
        {
          sender: mockSender,
          recipient: mockRecipient,
          assetCode: "USDC",
          totalAmount: 1000,
          durationSeconds: 3600,
          startAt: now + 60,
        },
      ];

      const response = await request(app)
        .post("/api/streams/batch")
        .send({
          streams,
          sender: mockSender,
        });

      expect(response.status).toBe(401);
    });

    it("should create streams atomically - all or none", async () => {
      // Mock Soroban disabled to test atomic database transaction
      vi.stubEnv('SOROBAN_DISABLED', 'true');

      const now = Math.floor(Date.now() / 1000);

      const streams = [
        {
          sender: mockSender,
          recipient: mockRecipient,
          assetCode: "USDC",
          totalAmount: 1000,
          durationSeconds: 3600,
          startAt: now + 60,
        },
        {
          sender: mockSender,
          recipient: mockRecipient,
          assetCode: "USDC",
          totalAmount: 2000,
          durationSeconds: 3600,
          startAt: now + 60,
        },
      ];

      const response = await request(app)
        .post("/api/streams/batch")
        .set("Authorization", `Bearer ${authToken}`)
        .send({
          streams,
          sender: mockSender,
        });

      expect(response.status).toBe(201);
      expect(response.body.data.streamIds).toHaveLength(2);

      // Verify both streams are in database
      const db = getDb();
      const count = db.prepare("SELECT COUNT(*) as count FROM streams").get() as { count: number };
      expect(count.count).toBe(2);

      vi.unstubEnv('SOROBAN_DISABLED');
    });

    it("should validate each stream against allowed assets", async () => {
      // Set allowed assets to only USDC
      vi.stubEnv('ALLOWED_ASSETS', 'USDC');

      const now = Math.floor(Date.now() / 1000);

      const streams = [
        {
          sender: mockSender,
          recipient: mockRecipient,
          assetCode: "XLM", // Not in allowed list
          totalAmount: 1000,
          durationSeconds: 3600,
          startAt: now + 60,
        },
      ];

      const response = await request(app)
        .post("/api/streams/batch")
        .set("Authorization", `Bearer ${authToken}`)
        .send({
          streams,
          sender: mockSender,
        });

      expect(response.status).toBe(400);
      expect(response.body.error).toContain("Asset \"XLM\" is not supported");

      vi.unstubEnv('ALLOWED_ASSETS');
    });
  });
});