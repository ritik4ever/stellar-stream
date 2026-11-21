import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import { Keypair } from "@stellar/stellar-sdk";

const SENDER_A = Keypair.random().publicKey();
const RECIPIENT_1 = Keypair.random().publicKey();

const mockStream = {
  id: "stream-consist-1035",
  sender: SENDER_A,
  recipient: RECIPIENT_1,
  assetCode: "USDC",
  totalAmount: 2500,
  durationSeconds: 7200,
  startAt: 1700000000,
  createdAt: 1700000000,
};

const streamStoreMocks = vi.hoisted(() => ({
  calculateProgress: vi.fn((stream: any) => ({
    status: "active",
    ratePerSecond: 2500 / 7200,
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
import {
  resetStreamIdempotencyForTesting,
  getIdempotentStream,
} from "./services/streamIdempotency";

describe("POST /api/streams Committed-State Consistency (SSB-2026-093 / #1035)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetStreamIdempotencyForTesting();
    streamStoreMocks.createStream.mockResolvedValue({ ...mockStream });
  });

  const validPayload = {
    sender: SENDER_A,
    recipient: RECIPIENT_1,
    assetCode: "USDC",
    totalAmount: 2500,
    durationSeconds: 7200,
    startAt: 1700000000,
  };

  describe("Committed state on success", () => {
    it("returns results matching committed database state exactly on success", async () => {
      const res = await request(app)
        .post("/api/streams")
        .set("idempotency-key", "idem-consist-success")
        .send(validPayload);

      expect(res.status).toBe(201);
      expect(res.body.data.id).toBe("stream-consist-1035");
      expect(res.body.data.totalAmount).toBe(2500);

      // Verify cached idempotent response matches the committed record
      const cached = getIdempotentStream("idem-consist-success");
      expect(cached).not.toBeNull();
      expect(cached?.id).toBe("stream-consist-1035");
    });
  });

  describe("Failure guarantees zero false state claims", () => {
    it("does not store idempotent response or claim a change after a failed creation attempt", async () => {
      streamStoreMocks.createStream.mockRejectedValueOnce(
        new Error("Database transaction rolled back"),
      );

      const res = await request(app)
        .post("/api/streams")
        .set("idempotency-key", "idem-consist-fail")
        .send(validPayload);

      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Failed to create stream.");

      // Key must not claim a change or store an idempotent success response
      const cached = getIdempotentStream("idem-consist-fail");
      expect(cached).toBeNull();
    });

    it("allows a subsequent valid retry to succeed after an earlier transient failure without conflict", async () => {
      // First attempt fails transiently
      streamStoreMocks.createStream.mockRejectedValueOnce(
        new Error("Transient connection error"),
      );
      const failRes = await request(app)
        .post("/api/streams")
        .set("idempotency-key", "idem-transient-key")
        .send(validPayload);
      expect(failRes.status).toBe(500);

      // Subsequent attempt with same key succeeds cleanly
      streamStoreMocks.createStream.mockResolvedValueOnce({ ...mockStream });
      const retryRes = await request(app)
        .post("/api/streams")
        .set("idempotency-key", "idem-transient-key")
        .send(validPayload);

      expect(retryRes.status).toBe(201);
      expect(retryRes.body.data.id).toBe("stream-consist-1035");
    });
  });
});
