import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import { Keypair } from "@stellar/stellar-sdk";
import {
  emitCreateStreamSignal,
  getLastPublishedCreateStreamSignal,
  resetCreateStreamSignalForTesting,
} from "./createStreamOutcome";

const SENDER_A = Keypair.random().publicKey();
const RECIPIENT_1 = Keypair.random().publicKey();

const mockStream = {
  id: "stream-signal-1036",
  sender: SENDER_A,
  recipient: RECIPIENT_1,
  assetCode: "USDC",
  totalAmount: 1500,
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

vi.mock("./streamStore", () => streamStoreMocks);
vi.mock("./cache", () => cacheMocks);
vi.mock("./eventHistory", () => eventHistoryMocks);
vi.mock("./db", () => dbMocks);
vi.mock("./auth", () => ({
  authMiddleware: vi.fn((req: any, res: any, next: any) => {
    req.user = { accountId: SENDER_A };
    next();
  }),
  adminJwtAuth: vi.fn((req: any, res: any, next: any) => next()),
  generateToken: vi.fn(() => "mock_token"),
  verifyToken: vi.fn(() => ({ accountId: SENDER_A })),
  getJwtSecret: vi.fn(() => "test_secret"),
}));
vi.mock("./indexer", () => ({
  initIndexer: vi.fn(),
  startIndexer: vi.fn(),
  stopIndexer: vi.fn(),
  getCircuitBreakerStatus: vi.fn(() => ({ state: "closed", failures: 0 })),
}));

import { app } from "../index";
import { resetStreamIdempotencyForTesting } from "./streamIdempotency";

describe("Create Stream Actionable Signals & Observability (SSB-2026-094 / #1036)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCreateStreamSignalForTesting();
    resetStreamIdempotencyForTesting();
    streamStoreMocks.createStream.mockResolvedValue({ ...mockStream });
  });

  const validPayload = {
    sender: SENDER_A,
    recipient: RECIPIENT_1,
    assetCode: "USDC",
    totalAmount: 1500,
    durationSeconds: 3600,
    startAt: 1700000000,
  };

  describe("Signal emitter unit tests", () => {
    it("emits structured outcome signal for success with deterministic code", () => {
      const signal = emitCreateStreamSignal({
        outcome: "success",
        detail: "Stream created successfully.",
        isNormalEmpty: false,
        isConcurrentConflict: false,
        isIdempotentReplay: false,
        latencyMs: 30,
        streamId: "stream-signal-1036",
        sender: SENDER_A,
        recipient: RECIPIENT_1,
        idempotencyKey: "test-idem-key",
        requestId: "req-signal-1",
      });

      expect(signal.outcome).toBe("success");
      expect(signal.outcomeCode).toBe(0);
      expect(signal.isConcurrentConflict).toBe(false);
      expect(signal.isIdempotentReplay).toBe(false);
      expect(signal.streamId).toBe("stream-signal-1036");
      expect(getLastPublishedCreateStreamSignal()).toEqual(signal);
    });

    it("never includes wallet secrets or private credentials in emitted telemetry", () => {
      const signal = emitCreateStreamSignal({
        outcome: "failure",
        detail: "Failed to simulate transaction on-chain.",
        isNormalEmpty: false,
        isConcurrentConflict: false,
        isIdempotentReplay: false,
        latencyMs: 40,
        sender: SENDER_A,
        recipient: RECIPIENT_1,
      });

      const serialized = JSON.stringify(signal);
      expect(serialized).not.toContain("secret");
      expect(serialized).not.toContain("seed");
      expect(serialized).not.toContain("privateKey");
    });
  });

  describe("POST /api/streams Signal Integration", () => {
    it("emits success signal upon initial stream creation", async () => {
      const res = await request(app)
        .post("/api/streams")
        .set("idempotency-key", "key-signal-success")
        .set("x-request-id", "req-create-success")
        .send(validPayload);

      expect(res.status).toBe(201);
      const signal = getLastPublishedCreateStreamSignal();
      expect(signal).not.toBeNull();
      expect(signal?.outcome).toBe("success");
      expect(signal?.streamId).toBe("stream-signal-1036");
      expect(signal?.requestId).toBe("req-create-success");
      expect(signal?.isConcurrentConflict).toBe(false);
      expect(signal?.isIdempotentReplay).toBe(false);
    });

    it("emits idempotent_replay signal on repeat POST after client timeout", async () => {
      // First request creates stream
      await request(app)
        .post("/api/streams")
        .set("idempotency-key", "key-signal-replay")
        .send(validPayload);

      // Second request replays
      const res = await request(app)
        .post("/api/streams")
        .set("idempotency-key", "key-signal-replay")
        .set("x-correlation-id", "corr-replay-id")
        .send(validPayload);

      expect(res.status).toBe(200);
      const signal = getLastPublishedCreateStreamSignal();
      expect(signal).not.toBeNull();
      expect(signal?.outcome).toBe("idempotent_replay");
      expect(signal?.isIdempotentReplay).toBe(true);
      expect(signal?.isNormalEmpty).toBe(true);
      expect(signal?.streamId).toBe("stream-signal-1036");
    });

    it("emits concurrent_conflict signal when two identical requests arrive together", async () => {
      let resolveCreate: (val: any) => void;
      const delayedPromise = new Promise((resolve) => {
        resolveCreate = resolve;
      });
      streamStoreMocks.createStream.mockReturnValueOnce(delayedPromise);

      const req1Promise = request(app)
        .post("/api/streams")
        .set("idempotency-key", "key-signal-race")
        .send(validPayload);

      await new Promise((r) => setTimeout(r, 10));

      const res2 = await request(app)
        .post("/api/streams")
        .set("idempotency-key", "key-signal-race")
        .set("x-request-id", "req-race-conflict")
        .send(validPayload);

      expect(res2.status).toBe(409);
      const signal = getLastPublishedCreateStreamSignal();
      expect(signal).not.toBeNull();
      expect(signal?.outcome).toBe("concurrent_conflict");
      expect(signal?.isConcurrentConflict).toBe(true);
      expect(signal?.requestId).toBe("req-race-conflict");

      resolveCreate!({ ...mockStream });
      await req1Promise;
    });

    it("emits failure signal when createStream throws an error", async () => {
      streamStoreMocks.createStream.mockRejectedValueOnce(new Error("RPC submission timeout"));

      const res = await request(app)
        .post("/api/streams")
        .set("idempotency-key", "key-signal-fail")
        .set("x-request-id", "req-rpc-fail")
        .send(validPayload);

      expect(res.status).toBe(500);
      const signal = getLastPublishedCreateStreamSignal();
      expect(signal).not.toBeNull();
      expect(signal?.outcome).toBe("failure");
      expect(signal?.isNormalEmpty).toBe(false);
      expect(signal?.requestId).toBe("req-rpc-fail");
    });
  });
});
