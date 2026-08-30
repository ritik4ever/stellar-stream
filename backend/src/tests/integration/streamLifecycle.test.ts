import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { app } from "../../index";
import { initDb, getDb } from "../../services/db";
import { initCache, getCache } from "../../services/cache";
import { Keypair } from "@stellar/stellar-sdk";
import path from "path";
import fs from "fs";
import { processEvent } from "../../services/indexer";
import { processWebhookQueue } from "../../services/webhookWorker";
import express from "express";
import http from "http";
import jwt from "jsonwebtoken";
import { getJwtSecret } from "../../services/auth";

vi.mock("@stellar/stellar-sdk", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@stellar/stellar-sdk")>();
  return {
    ...actual,
    scValToNative: (v: any) => v, // Mock scValToNative to just return the value in tests for easy event crafting
  };
});

const TEST_DB_PATH = path.join(__dirname, "..", "..", "..", "data", "test-stream-lifecycle.db");

describe("Stream Lifecycle Integration Test", () => {
  let mockServer: http.Server;
  let receivedWebhooks: any[] = [];
  let mockWebhookUrl = "";
  let token: string;
  const testAccountId = Keypair.random().publicKey();

  beforeAll(async () => {
    process.env.DB_PATH = TEST_DB_PATH;
    process.env.WEBHOOK_SIGNING_SECRET = "test-secret";

    initDb();
    initCache();

    token = jwt.sign({ accountId: testAccountId }, getJwtSecret(), { expiresIn: '1h' });

    // Start mock webhook server
    const mockApp = express();
    mockApp.use(express.json());
    mockApp.post("/webhook", (req, res) => {
      receivedWebhooks.push(req.body);
      res.status(200).send("OK");
    });
    
    await new Promise<void>((resolve) => {
      mockServer = mockApp.listen(0, "127.0.0.1", () => {
        const addr = mockServer.address() as any;
        mockWebhookUrl = `http://127.0.0.1:${addr.port}/webhook`;
        process.env.WEBHOOK_DESTINATION_URL = mockWebhookUrl;
        resolve();
      });
    });
  });

  beforeEach(async () => {
    receivedWebhooks = [];
    const db = getDb();
    db.exec("DELETE FROM stream_events");
    db.exec("DELETE FROM webhook_deliveries");
    db.exec("DELETE FROM webhook_dead_letters");
    db.exec("DELETE FROM streams");
    await getCache().clear();
  });

  afterAll(async () => {
    const db = getDb();
    db.close();
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
    await new Promise<void>((resolve) => mockServer.close(() => resolve()));
  });

  it("should complete the full lifecycle: create -> pause -> resume -> claim -> complete", async () => {
    const sender = testAccountId;
    const recipient = Keypair.random().publicKey();
    let streamId = "";
    
    // 1. Create Stream via API
    const createRes = await request(app)
      .post("/api/streams")
      .set("Authorization", `Bearer ${token}`)
      .send({
        sender,
        recipient,
        assetCode: "USDC",
        totalAmount: 1000,
        durationSeconds: 3600,
      });

    expect(createRes.status).toBe(201);
    streamId = createRes.body.data.id;

    const now = Math.floor(Date.now() / 1000);
    const db = getDb();

    // 2. Simulate indexer event for Stream Created
    processEvent(db, {
      topic: ["Stream", "Created"],
      value: {
        stream_id: BigInt(streamId),
        sender,
        recipient,
        token: "CUSDC",
        total_amount: BigInt(10000000000), // 1000 * 1e7
        start_time: BigInt(now),
        end_time: BigInt(now + 3600),
      },
      ledgerClosedAt: new Date().toISOString(),
      ledger: 1001,
    } as any);

    // 3. Pause Stream
    processEvent(db, {
      topic: ["Stream", "Paused"],
      value: {
        stream_id: BigInt(streamId),
      },
      ledgerClosedAt: new Date().toISOString(),
      ledger: 1002,
    } as any);

    // 4. Resume Stream
    processEvent(db, {
      topic: ["Stream", "Resumed"],
      value: {
        stream_id: BigInt(streamId),
      },
      ledgerClosedAt: new Date().toISOString(),
      ledger: 1003,
    } as any);

    // 5. Claim Stream
    processEvent(db, {
      topic: ["Stream", "Claimed"],
      value: {
        stream_id: BigInt(streamId),
        amount: BigInt(5000000000), // 500
        recipient,
      },
      ledgerClosedAt: new Date().toISOString(),
      ledger: 1004,
    } as any);

    // 6. Complete Stream
    processEvent(db, {
      topic: ["Stream", "Completed"],
      value: {
        stream_id: BigInt(streamId),
      },
      ledgerClosedAt: new Date().toISOString(),
      ledger: 1005,
    } as any);

    // Wait a brief moment and process all webhooks in queue
    await new Promise((resolve) => setTimeout(resolve, 100));
    await processWebhookQueue();
    // Wait for the deliveries to hit the mock server
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Verify database events
    const events = db.prepare("SELECT * FROM stream_events WHERE stream_id = ? ORDER BY ledger_sequence ASC").all(streamId) as any[];
    
    const eventTypes = events.map(e => e.event_type);
    expect(eventTypes).toEqual(["created", "paused", "resumed", "claimed", "completed"]);

    // Verify webhooks
    expect(receivedWebhooks.length).toBe(5);
    const webhookEvents = receivedWebhooks.map(w => w.event);
    expect(webhookEvents).toContain("stream.created");
    expect(webhookEvents).toContain("stream.paused");
    expect(webhookEvents).toContain("stream.resumed");
    expect(webhookEvents).toContain("stream.claimed");
    expect(webhookEvents).toContain("stream.completed");
  });
});
