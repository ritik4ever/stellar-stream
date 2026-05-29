import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "./index";
import { initDb, getDb } from "./services/db";
import { Keypair } from "@stellar/stellar-sdk";
import path from "path";
import fs from "fs";


// Use a separate test database
const TEST_DB_PATH = path.join(__dirname, "..", "data", "test-streams.db");

describe("Backend Integration Tests", () => {
  beforeAll(() => {
    // Set test database path
    process.env.DB_PATH = TEST_DB_PATH;

    // Initialize database
    initDb();
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

  describe("Health Check", () => {
    it("should return 200 and service status", async () => {
      const response = await request(app).get("/api/health");

      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        service: "stellar-stream-backend",
        status: "ok",
      });
      expect(response.body.timestamp).toBeDefined();
    });
  });

  describe("Stream Lifecycle", () => {
    const validSender = Keypair.random().publicKey();
    const validRecipient = Keypair.random().publicKey();

    const mockStream = {
      id: "1",
      sender: validSender,
      recipient: validRecipient,
      assetCode: "USDC",
      totalAmount: 1000,
      durationSeconds: 3600,
      startAt: Math.floor(Date.now() / 1000) + 3600,
      createdAt: Math.floor(Date.now() / 1000),
    };

    beforeEach(() => {
      // Insert test stream directly into database
      const db = getDb();
      db.prepare(`
        INSERT INTO streams (id, sender, recipient, asset_code, total_amount, duration_seconds, start_at, created_at)
        VALUES (@id, @sender, @recipient, @assetCode, @totalAmount, @durationSeconds, @startAt, @createdAt)
      `).run(mockStream);
    });

    describe("GET /api/streams", () => {
      it("should list all streams", async () => {
        const response = await request(app).get("/api/streams");

        expect(response.status).toBe(200);
        expect(response.body.data).toHaveLength(1);
        expect(response.body.total).toBe(1);
        expect(response.body.data[0]).toMatchObject({
          id: mockStream.id,
          sender: mockStream.sender,
          recipient: mockStream.recipient,
        });
      });

      it("should filter by status", async () => {
        const response = await request(app)
          .get("/api/streams")
          .query({ status: "scheduled" });

        expect(response.status).toBe(200);
        expect(response.body.data).toHaveLength(1);
        expect(response.body.data[0].progress.status).toBe("scheduled");
      });

      it("should filter by sender", async () => {
        const response = await request(app)
          .get("/api/streams")
          .query({ sender: mockStream.sender });

        expect(response.status).toBe(200);
        expect(response.body.data).toHaveLength(1);
      });

      it("should filter by recipient", async () => {
        const response = await request(app)
          .get("/api/streams")
          .query({ recipient: mockStream.recipient });

        expect(response.status).toBe(200);
        expect(response.body.data).toHaveLength(1);
      });

      it("should filter by asset", async () => {
        const response = await request(app)
          .get("/api/streams")
          .query({ asset: "USDC" });

        expect(response.status).toBe(200);
        expect(response.body.data).toHaveLength(1);
      });

      it("should filter by assetCode (single asset)", async () => {
        const response = await request(app)
          .get("/api/streams")
          .query({ assetCode: "USDC" });

        expect(response.status).toBe(200);
        expect(response.body.data).toHaveLength(1);
        expect(response.body.data[0].assetCode).toBe("USDC");
      });

      it("should filter by assetCode (multiple assets)", async () => {
        const db = getDb();
        // Add a stream with XLM asset
        db.prepare(`
          INSERT INTO streams (id, sender, recipient, asset_code, total_amount, duration_seconds, start_at, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          "999",
          mockStream.sender,
          mockStream.recipient,
          "XLM",
          mockStream.totalAmount,
          mockStream.durationSeconds,
          mockStream.startAt,
          mockStream.createdAt,
        );

        const response = await request(app)
          .get("/api/streams")
          .query({ assetCode: "USDC,XLM" });

        expect(response.status).toBe(200);
        expect(response.body.data).toHaveLength(2);
        const assetCodes = response.body.data.map((s: any) => s.assetCode);
        expect(assetCodes).toContain("USDC");
        expect(assetCodes).toContain("XLM");
      });

      it("should filter by assetCode (case-insensitive)", async () => {
        const response = await request(app)
          .get("/api/streams")
          .query({ assetCode: "usdc" });

        expect(response.status).toBe(200);
        expect(response.body.data).toHaveLength(1);
        expect(response.body.data[0].assetCode).toBe("USDC");
      });

      it("should search by query string", async () => {
        const response = await request(app)
          .get("/api/streams")
          .query({ q: mockStream.sender.substring(0, 10) });

        expect(response.status).toBe(200);
        expect(response.body.data).toHaveLength(1);
      });

      it("should paginate results", async () => {
        // Insert more streams
        const db = getDb();
        for (let i = 2; i <= 5; i++) {
          db.prepare(`
            INSERT INTO streams (id, sender, recipient, asset_code, total_amount, duration_seconds, start_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            i.toString(),
            mockStream.sender,
            mockStream.recipient,
            mockStream.assetCode,
            mockStream.totalAmount,
            mockStream.durationSeconds,
            mockStream.startAt,
            mockStream.createdAt + i
          );
        }

        const response = await request(app)
          .get("/api/streams")
          .query({ page: 2, limit: 2 });

        expect(response.status).toBe(200);
        expect(response.body.page).toBe(2);
        expect(response.body.limit).toBe(2);
        expect(response.body.total).toBe(5);
        expect(response.body.data).toHaveLength(2);
      });

      describe("pagination and filter combinations", () => {
        const senderA = "G" + "A".repeat(55);
        const senderB = "G" + "B".repeat(55);
        const recipientC = "G" + "C".repeat(55);
        const recipientD = "G" + "D".repeat(55);

        function seedStreams() {
          const db = getDb();
          db.exec("DELETE FROM streams");

          const now = Math.floor(Date.now() / 1000);
          const insert = db.prepare(`
            INSERT INTO streams (id, sender, recipient, asset_code, total_amount, duration_seconds, start_at, created_at, canceled_at, completed_at)
            VALUES (@id, @sender, @recipient, @assetCode, @totalAmount, @durationSeconds, @startAt, @createdAt, @canceledAt, @completedAt)
          `);

          for (let i = 1; i <= 25; i += 1) {
            let startAt = now - 5000;
            let durationSeconds = 10000;
            let canceledAt: number | null = null;
            let completedAt: number | null = null;

            if (i <= 10) {
              startAt = now - 5000; // active
              durationSeconds = 10000;
            } else if (i <= 15) {
              startAt = now + 5000; // scheduled
              durationSeconds = 10000;
            } else if (i <= 20) {
              startAt = now - 20000; // completed
              durationSeconds = 1000;
              completedAt = now - 100;
            } else {
              startAt = now - 5000; // canceled
              durationSeconds = 10000;
              canceledAt = now - 100;
            }

            insert.run({
              id: i.toString(),
              sender: i % 2 === 0 ? senderA : senderB,
              recipient: i % 3 === 0 ? recipientD : recipientC,
              assetCode: i % 5 === 0 ? "uSdC" : "XLM",
              totalAmount: 1000 + i,
              durationSeconds,
              startAt,
              createdAt: now - i,
              canceledAt,
              completedAt,
            });
          }
        }

        it("should include pagination metadata for multi-page results", async () => {
          seedStreams();

          const pageOne = await request(app)
            .get("/api/streams")
            .query({ page: 1, limit: 20 });

          expect(pageOne.status).toBe(200);
          expect(pageOne.body.total).toBe(25);
          expect(pageOne.body.page).toBe(1);
          expect(pageOne.body.limit).toBe(20);
          expect(pageOne.body.data).toHaveLength(20);

          const pageTwo = await request(app)
            .get("/api/streams")
            .query({ page: 2, limit: 20 });

          expect(pageTwo.status).toBe(200);
          expect(pageTwo.body.total).toBe(25);
          expect(pageTwo.body.page).toBe(2);
          expect(pageTwo.body.limit).toBe(20);
          expect(pageTwo.body.data).toHaveLength(5);
        });

        it("should apply q filtering across id, sender, recipient, and asset", async () => {
          seedStreams();

          const byId = await request(app)
            .get("/api/streams")
            .query({ q: "19" });

          expect(byId.status).toBe(200);
          expect(byId.body.data.map((stream: any) => stream.id)).toContain("19");

          const bySender = await request(app)
            .get("/api/streams")
            .query({ q: "bbb" });

          expect(bySender.status).toBe(200);
          expect(bySender.body.data.every((stream: any) => stream.sender === senderB)).toBe(
            true,
          );

          const byRecipient = await request(app)
            .get("/api/streams")
            .query({ q: "ddd" });

          expect(byRecipient.status).toBe(200);
          expect(
            byRecipient.body.data.every((stream: any) => stream.recipient === recipientD),
          ).toBe(true);

          const byAsset = await request(app)
            .get("/api/streams")
            .query({ q: "sDc" });

          expect(byAsset.status).toBe(200);
          expect(
            byAsset.body.data.every(
              (stream: any) => stream.assetCode.toLowerCase() === "usdc",
            ),
          ).toBe(true);
        });

        it("should combine status and q filters", async () => {
          seedStreams();

          const response = await request(app)
            .get("/api/streams")
            .query({
              status: "active",
              sender: senderB,
              recipient: recipientD,
              asset: "XLM",
              q: "3",
            });

          expect(response.status).toBe(200);
          expect(response.body.data.map((stream: any) => stream.id)).toEqual(["3"]);
        });

        it("should return all matching rows when pagination params are omitted", async () => {
          seedStreams();

          const response = await request(app)
            .get("/api/streams")
            .query({ status: "active" });

          expect(response.status).toBe(200);
          expect(response.body.total).toBe(10);
          expect(response.body.data).toHaveLength(10);
        });
      });

      it("should return 400 for invalid status", async () => {
        const response = await request(app)
          .get("/api/streams")
          .query({ status: "invalid" });

        expect(response.status).toBe(400);
        expect(response.body.error).toContain("status must be one of");
      });

      it("should return 400 for invalid page", async () => {
        const response = await request(app)
          .get("/api/streams")
          .query({ page: 0 });

        expect(response.status).toBe(400);
        expect(response.body.error).toContain("page must be greater than or equal to 1");
      });

      it("should return 400 for invalid limit", async () => {
        const response = await request(app)
          .get("/api/streams")
          .query({ limit: 101 });

        expect(response.status).toBe(400);
        expect(response.body.error).toContain("limit must be less than or equal to 100");
      });
    });

    describe("GET /api/streams/:id", () => {
      it("should get a specific stream", async () => {
        const response = await request(app).get(`/api/streams/${mockStream.id}`);

        expect(response.status).toBe(200);
        expect(response.body.data).toMatchObject({
          id: mockStream.id,
          sender: mockStream.sender,
          recipient: mockStream.recipient,
        });
        expect(response.body.data.progress).toBeDefined();
      });

      it("should return 404 for non-existent stream", async () => {
        const response = await request(app).get("/api/streams/999");

        expect(response.status).toBe(404);
        expect(response.body.error).toBe("Stream not found.");
      });

      it("should return 400 for invalid stream ID", async () => {
        const response = await request(app).get("/api/streams/invalid-id");

        expect(response.status).toBe(400);
        expect(response.body.error).toContain("Stream ID must be");
      });
    });

    describe("GET /api/recipients/:accountId/streams", () => {
      it("should get streams for a recipient", async () => {
        const response = await request(app)
          .get(`/api/recipients/${mockStream.recipient}/streams`);

        expect(response.status).toBe(200);
        expect(response.body.data).toHaveLength(1);
        expect(response.body.data[0].recipient).toBe(mockStream.recipient);
        expect(response.body.data[0].progress).toBeDefined(); // Verify progress is computed
      });

      it("should return empty array for recipient with no streams", async () => {
        const emptyRecipient = Keypair.random().publicKey();
        const response = await request(app)
          .get(`/api/recipients/${emptyRecipient}/streams`);

        expect(response.status).toBe(200);
        expect(response.body.data).toEqual([]); // Assert empty data array
        expect(response.body.total).toBe(0);
      });


      it("should return 400 for account ID that does not start with G", async () => {
        const response = await request(app)
          .get("/api/recipients/ABBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB/streams");

        expect(response.status).toBe(400);
        expect(response.body.error).toContain("must be a valid Stellar account ID");
      });

      it("should return 400 for account ID that is 55 chars", async () => {
        const response = await request(app)
          .get("/api/recipients/GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB/streams");

        expect(response.status).toBe(400);
        expect(response.body.error).toContain("must be a valid Stellar account ID");
      });

      it("should return 400 for invalid account ID format", async () => {
        const response = await request(app)
          .get("/api/recipients/invalid/streams");

        expect(response.status).toBe(400);
        expect(response.body.error).toContain("must be a valid Stellar account ID");
      });
    });

    describe("GET /api/senders/:accountId/streams", () => {
      it("should get streams for a sender", async () => {
        const response = await request(app)
          .get(`/api/senders/${mockStream.sender}/streams`);

        expect(response.status).toBe(200);
        expect(response.body.data).toHaveLength(1);
        expect(response.body.data[0].sender).toBe(mockStream.sender);
      });

      it("should filter sender streams by status", async () => {
        const response = await request(app)
          .get(`/api/senders/${mockStream.sender}/streams`)
          .query({ status: "scheduled" });

        expect(response.status).toBe(200);
        expect(response.body.data).toHaveLength(1);
      });

      it("should paginate sender streams", async () => {
        // Insert more streams for the same sender
        const db = getDb();
        for (let i = 2; i <= 3; i++) {
          db.prepare(`
            INSERT INTO streams (id, sender, recipient, asset_code, total_amount, duration_seconds, start_at, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
          `).run(
            i.toString(),
            mockStream.sender,
            mockStream.recipient,
            mockStream.assetCode,
            mockStream.totalAmount,
            mockStream.durationSeconds,
            mockStream.startAt,
            mockStream.createdAt + i
          );
        }

        const response = await request(app)
          .get(`/api/senders/${mockStream.sender}/streams`)
          .query({ page: 1, limit: 2 });

        expect(response.status).toBe(200);
        expect(response.body.total).toBe(3);
        expect(response.body.data).toHaveLength(2);
      });

      it("should return 400 for invalid account ID", async () => {
        const response = await request(app)
          .get("/api/senders/invalid/streams");

        expect(response.status).toBe(400);
        expect(response.body.error).toContain("must be a valid Stellar account ID");
      });

      it("should return empty array for sender with no streams", async () => {
        const emptySender = Keypair.random().publicKey();
        const response = await request(app)
          .get(`/api/senders/${emptySender}/streams`);

        expect(response.status).toBe(200);
        expect(response.body.data).toEqual([]);
        expect(response.body.total).toBe(0);
      });
    });
  });

  describe("Stream History", () => {
    const mockStream = {
      id: "1",
      sender: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
      recipient: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
      assetCode: "USDC",
      totalAmount: 1000,
      durationSeconds: 3600,
      startAt: Math.floor(Date.now() / 1000) + 3600,
      createdAt: Math.floor(Date.now() / 1000),
    };

    beforeEach(() => {
      const db = getDb();

      // Insert stream
      db.prepare(`
        INSERT INTO streams (id, sender, recipient, asset_code, total_amount, duration_seconds, start_at, created_at)
        VALUES (@id, @sender, @recipient, @assetCode, @totalAmount, @durationSeconds, @startAt, @createdAt)
      `).run(mockStream);

      // Insert events
      db.prepare(`
        INSERT INTO stream_events (stream_id, event_type, timestamp, actor, amount)
        VALUES (?, ?, ?, ?, ?)
      `).run(mockStream.id, "created", mockStream.createdAt, mockStream.sender, mockStream.totalAmount);
    });

    describe("GET /api/streams/:id/history", () => {
      it("should get stream history", async () => {
        const response = await request(app)
          .get(`/api/streams/${mockStream.id}/history`);

        expect(response.status).toBe(200);
        expect(response.body.data).toHaveLength(1);
        expect(response.body.data[0]).toMatchObject({
          streamId: mockStream.id,
          eventType: "created",
          actor: mockStream.sender,
        });
      });

      it("should return 404 for non-existent stream", async () => {
        const response = await request(app)
          .get("/api/streams/999/history");

        expect(response.status).toBe(404);
        expect(response.body.error).toBe("Stream not found.");
      });

      it("should record stream_completed event when stream fully vests", async () => {
        const db = getDb();
        const now = Math.floor(Date.now() / 1000);

        // Create a stream that has already completed
        const completedStream = {
          id: "9999",
          sender: "GC7Y4M77LNYKYF4K4V5A737W3G3L3T7XQWZJZL4R64Z43W3T7XZQK2L4",
          recipient: "GB4Z3ZK3X24Z3T7XZQK2L4R64Z43W3T7XZQK2L4R64Z43W3T7XZQK2L4",
          asset_code: "USDC",
          total_amount: 1000,
          duration_seconds: 3600,
          start_at: now - 7200, // Started 2 hours ago
          created_at: now - 7200,
          canceled_at: null,
          completed_at: null,
          refunded_amount: null,
          archived_at: null,
          paused_at: null,
          paused_duration: 0,
        };

        db.prepare(`
          INSERT INTO streams (id, sender, recipient, asset_code, total_amount, duration_seconds, start_at, created_at, canceled_at, completed_at, refunded_amount, archived_at, paused_at, paused_duration)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          completedStream.id,
          completedStream.sender,
          completedStream.recipient,
          completedStream.asset_code,
          completedStream.total_amount,
          completedStream.duration_seconds,
          completedStream.start_at,
          completedStream.created_at,
          completedStream.canceled_at,
          completedStream.completed_at,
          completedStream.refunded_amount,
          completedStream.archived_at,
          completedStream.paused_at,
          completedStream.paused_duration,
        );

        // Record created event
        db.prepare(`
          INSERT INTO stream_events (stream_id, event_type, timestamp, actor)
          VALUES (?, ?, ?, ?)
        `).run(completedStream.id, "created", completedStream.created_at, completedStream.sender);

        // Call refreshStreamStatuses to mark stream as completed and record event
        const { refreshStreamStatuses } = await import("./services/streamStore");
        refreshStreamStatuses();

        // Verify stream is marked as completed
        const response = await request(app)
          .get(`/api/streams/${completedStream.id}/history`);

        expect(response.status).toBe(200);
        expect(response.body.data).toHaveLength(2);

        const completedEvent = response.body.data.find((e: any) => e.eventType === "completed");
        expect(completedEvent).toBeDefined();
        expect(completedEvent.streamId).toBe(completedStream.id);
      });
    });

    describe("GET /api/streams/:id/snapshot", () => {
      it("should get stream snapshot with history", async () => {
        const response = await request(app)
          .get(`/api/streams/${mockStream.id}/snapshot`);

        expect(response.status).toBe(200);
        expect(response.body.data.stream).toBeDefined();
        expect(response.body.data.history).toBeDefined();
        expect(response.body.data.stream.id).toBe(mockStream.id);
        expect(response.body.data.history).toHaveLength(1);
      });

      it("should return 404 for non-existent stream", async () => {
        const response = await request(app)
          .get("/api/streams/999/snapshot");

        expect(response.status).toBe(404);
        expect(response.body.error).toBe("Stream not found.");
      });
    });
  });

  describe("Global Events", () => {
    beforeEach(() => {
      const db = getDb();
      const now = Math.floor(Date.now() / 1000);

      // Insert test streams
      for (let i = 1; i <= 3; i++) {
        db.prepare(`
          INSERT INTO streams (id, sender, recipient, asset_code, total_amount, duration_seconds, start_at, created_at)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
          i.toString(),
          "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
          "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
          "USDC",
          1000,
          3600,
          now + 3600,
          now
        );

        // Insert events
        db.prepare(`
          INSERT INTO stream_events (stream_id, event_type, timestamp, actor, amount)
          VALUES (?, ?, ?, ?, ?)
        `).run(i.toString(), "created", now + i, "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF", 1000);
      }

      // Add a canceled event
      db.prepare(`
        INSERT INTO stream_events (stream_id, event_type, timestamp, actor)
        VALUES (?, ?, ?, ?)
      `).run("1", "canceled", now + 100, "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF");
    });

    describe("GET /api/events", () => {
      it("should list all events", async () => {
        const response = await request(app).get("/api/events");

        expect(response.status).toBe(200);
        expect(response.body.data).toHaveLength(4);
        expect(response.body.total).toBe(4);
      });

      it("should filter by event type", async () => {
        const response = await request(app)
          .get("/api/events")
          .query({ eventType: "created" });

        expect(response.status).toBe(200);
        expect(response.body.data).toHaveLength(3);
        expect(response.body.data.every((e: any) => e.eventType === "created")).toBe(true);
      });

      it("should paginate events", async () => {
        const response = await request(app)
          .get("/api/events")
          .query({ page: 2, limit: 2 });

        expect(response.status).toBe(200);
        expect(response.body.page).toBe(2);
        expect(response.body.limit).toBe(2);
        expect(response.body.total).toBe(4);
        expect(response.body.data).toHaveLength(2);
      });

      it("should return 400 for invalid event type", async () => {
        const response = await request(app)
          .get("/api/events")
          .query({ eventType: "invalid" });

        expect(response.status).toBe(400);
        expect(response.body.error).toContain("eventType must be one of");
      });

      it("should support cursor-based pagination", async () => {
        // We have 4 events in total from beforeEach
        const firstPage = await request(app)
          .get("/api/events")
          .query({ limit: 2 });

        expect(firstPage.status).toBe(200);
        expect(firstPage.body.data).toHaveLength(2);

        const cursor = firstPage.body.data[1].id;

        const secondPage = await request(app)
          .get("/api/events")
          .query({ limit: 2, cursor });

        expect(secondPage.status).toBe(200);
        expect(secondPage.body.data).toHaveLength(2);
        // All IDs in second page should be less than the cursor
        secondPage.body.data.forEach((e: any) => {
          expect(e.id).toBeLessThan(cursor);
        });
      });

      it("should include events across multiple streams", async () => {
        const response = await request(app).get("/api/events");
        const streamIds = new Set(response.body.data.map((e: any) => e.streamId));

        expect(streamIds.size).toBeGreaterThan(1);
        expect(streamIds.has("1")).toBe(true);
        expect(streamIds.has("2")).toBe(true);
        expect(streamIds.has("3")).toBe(true);
      });
    });
  });

  describe("Export Functionality", () => {
    beforeEach(() => {
      const db = getDb();
      const now = Math.floor(Date.now() / 1000);

      // Insert test streams with different statuses
      db.prepare(`
        INSERT INTO streams (id, sender, recipient, asset_code, total_amount, duration_seconds, start_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        "1",
        "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
        "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
        "USDC",
        1000,
        3600,
        now - 7200, // Started 2 hours ago
        now - 7200
      );

      db.prepare(`
        INSERT INTO streams (id, sender, recipient, asset_code, total_amount, duration_seconds, start_at, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        "2",
        "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
        "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
        "XLM",
        2000,
        7200,
        now + 3600, // Scheduled
        now
      );
    });

    describe("GET /api/streams/export.csv", () => {
      it("should export all streams as CSV", async () => {
        const response = await request(app)
          .get("/api/streams/export.csv");

        expect(response.status).toBe(200);
        expect(response.headers["content-type"]).toContain("text/csv");
        expect(response.headers["content-disposition"]).toContain("export.csv");
        expect(response.text).toContain("id,sender,recipient,asset,total,status,startAt");
        expect(response.text).toContain("USDC");
        expect(response.text).toContain("XLM");
      });

      it("should filter CSV export by status", async () => {
        const response = await request(app)
          .get("/api/streams/export.csv")
          .query({ status: "scheduled" });

        expect(response.status).toBe(200);
        expect(response.text).toContain("XLM");
        expect(response.text).not.toContain("active");
      });

      it("should filter CSV export by asset", async () => {
        const response = await request(app)
          .get("/api/streams/export.csv")
          .query({ asset: "USDC" });

        expect(response.status).toBe(200);
        expect(response.text).toContain("USDC");
        // CSV has header + data rows, no trailing newline
        const lines = response.text.split("\n").filter(line => line.trim());
        expect(lines.length).toBe(2); // Header + 1 data row
      });

      it("should filter CSV export by sender", async () => {
        const response = await request(app)
          .get("/api/streams/export.csv")
          .query({ sender: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF" });

        expect(response.status).toBe(200);
        expect(response.text).toContain("GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF");
      });
    });
  });

  describe("Error Handling", () => {
    it("should handle database errors gracefully", async () => {
      // Close the database to simulate an error
      const db = getDb();
      db.close();

      const response = await request(app).get("/api/streams");

      expect(response.status).toBe(500);

      // Re-initialize for subsequent tests
      initDb();
    });
  });

  describe("Assets API", () => {
    it("should return the list of allowed assets", async () => {
      const response = await request(app).get("/api/assets");

      expect(response.status).toBe(200);
      expect(response.body.data).toEqual(expect.arrayContaining(["USDC", "XLM"]));
    });

    it("should return normalized assets (uppercase)", async () => {
      // The app.ts or index.ts already normalizes it during startup or at each request?
      // Actually index.ts line 78-80 normalizes it.
      const response = await request(app).get("/api/assets");
      response.body.data.forEach((asset: string) => {
        expect(asset).toBe(asset.toUpperCase());
      });
    });
  });

  describe("Rate Limiting", () => {
    it("should enforce mutation rate limit on POST /api/streams", async () => {
      const sender = Keypair.random().publicKey();
      const recipient = Keypair.random().publicKey();

      const payload = {
        sender,
        recipient,
        assetCode: "USDC",
        totalAmount: 1000,
        durationSeconds: 3600,
      };

      // Make 11 requests (limit is 10 per minute)
      for (let i = 0; i < 11; i++) {
        const response = await request(app)
          .post("/api/streams")
          .send(payload);

        if (i < 10) {
          // First 10 should succeed or fail with auth error (no token), not rate limit
          expect([200, 201, 401, 400]).toContain(response.status);
        } else {
          // 11th should be rate limited
          expect(response.status).toBe(429);
          expect(response.body.code).toBe("RATE_LIMIT_EXCEEDED");
          expect(response.headers["retry-after"]).toBeDefined();
        }
      }
    });

    it("should return Retry-After header on rate limit", async () => {
      const sender = Keypair.random().publicKey();
      const recipient = Keypair.random().publicKey();

      const payload = {
        sender,
        recipient,
        assetCode: "USDC",
        totalAmount: 1000,
        durationSeconds: 3600,
      };

      // Make requests to hit the limit
      for (let i = 0; i < 11; i++) {
        await request(app).post("/api/streams").send(payload);
      }

      // 11th request should have Retry-After header
      const response = await request(app)
        .post("/api/streams")
        .send(payload);

      expect(response.status).toBe(429);
      expect(response.headers["retry-after"]).toBeDefined();
      const retryAfter = parseInt(response.headers["retry-after"], 10);
      expect(retryAfter).toBeGreaterThan(0);
      expect(retryAfter).toBeLessThanOrEqual(60);
    });
  });
});
