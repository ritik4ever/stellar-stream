import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "./index";
import { initDb, getDb } from "./services/db";
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
    db.exec("DELETE FROM streams");
    db.exec("DELETE FROM webhook_deliveries");
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
      });

      it("should return empty array for recipient with no streams", async () => {
        const response = await request(app)
          .get("/api/recipients/GCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCCC/streams");
        
        expect(response.status).toBe(200);
        expect(response.body.data).toHaveLength(0);
      });

      it("should return 400 for invalid account ID", async () => {
        const response = await request(app)
          .get("/api/recipients/invalid/streams");
        
        expect(response.status).toBe(400);
        expect(response.body.error).toContain("Must be a valid Stellar account ID");
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
        expect(response.body.error).toContain("Must be a valid Stellar account ID");
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
    });
  });
});
