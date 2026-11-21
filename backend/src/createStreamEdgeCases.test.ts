import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import { Keypair } from "@stellar/stellar-sdk";

const SENDER_A = Keypair.random().publicKey();
const RECIPIENT_1 = Keypair.random().publicKey();

const mockStream = {
  id: "stream-edge-1037",
  sender: SENDER_A,
  recipient: RECIPIENT_1,
  assetCode: "USDC",
  totalAmount: 1000,
  durationSeconds: 3600,
  startAt: 1700000000,
  createdAt: 1700000000,
};

const streamStoreMocks = vi.hoisted(() => ({
  calculateProgress: vi.fn((stream: any) => ({
    status: "active",
    ratePerSecond: 1.0,
    elapsedSeconds: 0,
    vestedAmount: 0,
    remainingAmount: stream.totalAmount,
    percentComplete: 0,
  })),
  cancelStream: vi.fn(),
  createStream: vi.fn(),
  getStream: vi.fn(),
  initSoroban: vi.fn(),
  listStreams: vi.fn(() => []),
  listStreamsBySender: vi.fn(() => []),
  listStreamsByRecipient: vi.fn(() => []),
  nowInSeconds: vi.fn(() => 1700000000),
  syncStreams: vi.fn(),
  updateStreamStartAt: vi.fn(),
}));

const cacheMocks = vi.hoisted(() => ({
  getCache: vi.fn(() => ({
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
  })),
  initCache: vi.fn(),
}));

const eventHistoryMocks = vi.hoisted(() => ({
  getStreamHistory: vi.fn(),
  getAllEvents: vi.fn(),
  getGlobalEvents: vi.fn(),
  countAllEvents: vi.fn(),
  countStreamEvents: vi.fn(),
  recordEvent: vi.fn(),
  getStreamEventSummary: vi.fn(),
}));

const dbMocks = vi.hoisted(() => ({
  getDb: vi.fn(),
  initDb: vi.fn(),
  searchStreamsFts: vi.fn(() => []),
  getAllowedAssets: vi.fn(() => ["USDC", "XLM"]),
  addAllowedAsset: vi.fn(),
  removeAllowedAsset: vi.fn(),
  syncFtsIndex: vi.fn(),
}));

vi.mock("./services/streamStore", () => streamStoreMocks);
vi.mock("./services/cache", () => cacheMocks);
vi.mock("./services/eventHistory", () => eventHistoryMocks);
vi.mock("./services/db", () => dbMocks);
vi.mock("./services/auth", () => ({
  authMiddleware: vi.fn((req: any, res: any, next: any) => {
    req.user = { accountId: SENDER_A };
    next();
  }),
  adminJwtAuth: vi.fn((req: any, res: any, next: any) => next()),
  generateToken: vi.fn(() => "mock_token"),
  verifyToken: vi.fn(() => ({ accountId: SENDER_A })),
  getJwtSecret: vi.fn(() => "test_secret"),
}));
vi.mock("./services/indexer", () => ({
  initIndexer: vi.fn(),
  startIndexer: vi.fn(),
  stopIndexer: vi.fn(),
  getCircuitBreakerStatus: vi.fn(() => ({ state: "closed", failures: 0 })),
}));

import { app } from "./index";
import { resetIdempotencyStoreForTesting } from "./services/streamIdempotency";

describe("POST /api/streams Concurrency & Timeout Edge Cases (SSB-2026-095 / #1037)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetIdempotencyStoreForTesting();
    streamStoreMocks.createStream.mockResolvedValue({ ...mockStream });
  });

  const validPayload = {
    sender: SENDER_A,
    recipient: RECIPIENT_1,
    assetCode: "USDC",
    totalAmount: 1000,
    durationSeconds: 3600,
    startAt: 1700000000,
  };

  describe("Repeat POST after client timeout (idempotent replay)", () => {
    it("returns HTTP 201 on initial stream creation and stores exactly one stream", async () => {
      const res = await request(app)
        .post("/api/streams")
        .set("idempotency-key", "idem-timeout-test-1")
        .send(validPayload);

      expect(res.status).toBe(201);
      expect(res.body.data.id).toBe("stream-edge-1037");
      expect(streamStoreMocks.createStream).toHaveBeenCalledTimes(1);
    });

    it("returns HTTP 200 with X-Idempotent-Replay header and identical data on repeat POST after client timeout", async () => {
      // First attempt succeeds
      const res1 = await request(app)
        .post("/api/streams")
        .set("idempotency-key", "idem-timeout-test-2")
        .send(validPayload);
      expect(res1.status).toBe(201);

      // Client timed out waiting for network ack and retries with same idempotency key
      const res2 = await request(app)
        .post("/api/streams")
        .set("idempotency-key", "idem-timeout-test-2")
        .send(validPayload);

      expect(res2.status).toBe(200);
      expect(res2.headers["x-idempotent-replay"]).toBe("true");
      expect(res2.body.data.id).toBe("stream-edge-1037");
      expect(res2.body.data.totalAmount).toBe(1000);

      // Critical assertion: createStream was NOT called twice (zero duplicate side effects)
      expect(streamStoreMocks.createStream).toHaveBeenCalledTimes(1);
    });
  });

  describe("Two identical requests arriving together (concurrency guard)", () => {
    it("returns HTTP 409 Conflict when an identical request is already in-flight", async () => {
      // Delay createStream execution to simulate in-flight window
      let resolveCreate: (val: any) => void;
      const delayedPromise = new Promise((resolve) => {
        resolveCreate = resolve;
      });
      streamStoreMocks.createStream.mockReturnValueOnce(delayedPromise);

      // Dispatch request 1
      const req1Promise = request(app)
        .post("/api/streams")
        .set("idempotency-key", "idem-race-test-1")
        .send(validPayload);

      // Wait a tick for request 1 to mark key in-flight
      await new Promise((r) => setTimeout(r, 10));

      // Dispatch simultaneous identical request 2
      const res2 = await request(app)
        .post("/api/streams")
        .set("idempotency-key", "idem-race-test-1")
        .send(validPayload);

      // Request 2 must fail fast with 409 Conflict
      expect(res2.status).toBe(409);
      expect(res2.body.error).toMatch(/currently in flight/i);
      expect(res2.body.code).toBe("CONFLICT");

      // Complete request 1
      resolveCreate!({ ...mockStream });
      const res1 = await req1Promise;
      expect(res1.status).toBe(201);

      // createStream executed only once
      expect(streamStoreMocks.createStream).toHaveBeenCalledTimes(1);
    });
  });
});
