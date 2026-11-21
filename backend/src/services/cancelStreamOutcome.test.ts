import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { app } from "../index";
import {
  emitCancelStreamSignal,
  getLastPublishedCancelStreamSignal,
  resetCancelStreamSignalForTesting,
  CancelStreamOutcomeSignal,
} from "./cancelStreamOutcome";

const mockSender = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const mockRecipient = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

const activeStream = {
  id: "stream-cancel-001",
  sender: mockSender,
  recipient: mockRecipient,
  assetCode: "USDC",
  totalAmount: 1000,
  claimedAmount: 0,
  durationSeconds: 3600,
  startAt: 1700000000,
  createdAt: 1700000000,
};

const completedStream = {
  id: "stream-cancel-002",
  sender: mockSender,
  recipient: mockRecipient,
  assetCode: "USDC",
  totalAmount: 1000,
  claimedAmount: 1000,
  durationSeconds: 3600,
  startAt: 1700000000,
  createdAt: 1700000000,
};

const alreadyCanceledStream = {
  id: "stream-cancel-003",
  sender: mockSender,
  recipient: mockRecipient,
  assetCode: "USDC",
  totalAmount: 1000,
  claimedAmount: 200,
  durationSeconds: 3600,
  startAt: 1700000000,
  createdAt: 1700000000,
  canceledAt: 1700001000,
};

const streamStoreMocks = vi.hoisted(() => ({
  calculateProgress: vi.fn((stream: any) => ({
    status: stream.claimedAmount >= stream.totalAmount ? "completed" : stream.canceledAt ? "canceled" : "active",
    ratePerSecond: 1.0,
    elapsedSeconds: 500,
    vestedAmount: 500,
    remainingAmount: stream.totalAmount - (stream.claimedAmount ?? 0),
    percentComplete: 50,
  })),
  cancelStream: vi.fn(),
  createStream: vi.fn(),
  getStream: vi.fn(),
  initSoroban: vi.fn(),
  listStreams: vi.fn(() => []),
  listStreamsBySender: vi.fn(() => []),
  listStreamsByRecipient: vi.fn(() => []),
  nowInSeconds: vi.fn(() => 1700002000),
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
vi.mock("./db", () => dbMocks);
vi.mock("./auth", () => ({
  authMiddleware: vi.fn((req: any, res: any, next: any) => {
    req.user = { accountId: mockSender };
    next();
  }),
  adminJwtAuth: vi.fn((req: any, res: any, next: any) => next()),
  generateToken: vi.fn(() => "mock_token"),
  verifyToken: vi.fn(() => ({ accountId: mockSender })),
  getJwtSecret: vi.fn(() => "test_secret"),
}));
vi.mock("./indexer", () => ({
  initIndexer: vi.fn(),
  startIndexer: vi.fn(),
  stopIndexer: vi.fn(),
  getCircuitBreakerStatus: vi.fn(() => ({ state: "closed", failures: 0 })),
}));

describe("Cancel Stream Actionable Signals & Observability (SSB-2026-099 / #1041)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    resetCancelStreamSignalForTesting();
  });

  describe("Signal emitter unit tests", () => {
    it("emits structured outcome signal for success with deterministic outcomeCode", () => {
      const signal = emitCancelStreamSignal({
        outcome: "success",
        detail: "Stream cancelled successfully.",
        isNormalEmpty: false,
        isRacingClaim: false,
        isRepeatedCancel: false,
        latencyMs: 15,
        streamId: "stream-001",
        sender: mockSender,
        recipient: mockRecipient,
        requestId: "req-123",
      });

      expect(signal.outcome).toBe("success");
      expect(signal.outcomeCode).toBe(0);
      expect(signal.isNormalEmpty).toBe(false);
      expect(signal.isRacingClaim).toBe(false);
      expect(signal.isRepeatedCancel).toBe(false);
      expect(signal.streamId).toBe("stream-001");
      expect(getLastPublishedCancelStreamSignal()).toEqual(signal);
    });

    it("emits structured signal for racing claim with isRacingClaim=true", () => {
      const signal = emitCancelStreamSignal({
        outcome: "racing_claim",
        detail: "Cancel succeeded with racing claim settlement.",
        isNormalEmpty: false,
        isRacingClaim: true,
        isRepeatedCancel: false,
        latencyMs: 25,
        streamId: "stream-002",
        sender: mockSender,
        recipient: mockRecipient,
      });

      expect(signal.outcome).toBe("racing_claim");
      expect(signal.outcomeCode).toBe(3);
      expect(signal.isRacingClaim).toBe(true);
    });

    it("never includes wallet secrets or private credentials in signal output", () => {
      const signal = emitCancelStreamSignal({
        outcome: "failure",
        detail: "Contract simulation aborted on-chain.",
        isNormalEmpty: false,
        isRacingClaim: false,
        isRepeatedCancel: false,
        latencyMs: 35,
        streamId: "stream-003",
        sender: mockSender,
        recipient: mockRecipient,
      });

      const serialized = JSON.stringify(signal);
      expect(serialized).not.toContain("secret");
      expect(serialized).not.toContain("privateKey");
      expect(serialized).not.toContain("seed");
    });
  });

  describe("POST /api/streams/:id/cancel Signal Integration", () => {
    it("emits success signal when cancelling an active stream", async () => {
      streamStoreMocks.getStream.mockReturnValue({ ...activeStream });
      streamStoreMocks.cancelStream.mockResolvedValue({
        ...activeStream,
        canceledAt: 1700002000,
      });

      const res = await request(app)
        .post("/api/streams/stream-cancel-001/cancel")
        .set("x-request-id", "req-cancel-active");

      expect(res.status).toBe(200);
      const signal = getLastPublishedCancelStreamSignal();
      expect(signal).not.toBeNull();
      expect(signal?.outcome).toBe("success");
      expect(signal?.streamId).toBe("stream-cancel-001");
      expect(signal?.requestId).toBe("req-cancel-active");
      expect(signal?.isRepeatedCancel).toBe(false);
      expect(signal?.isRacingClaim).toBe(false);
    });

    it("emits already_canceled signal when repeatedly cancelling an already canceled stream", async () => {
      streamStoreMocks.getStream.mockReturnValue({ ...alreadyCanceledStream });
      streamStoreMocks.cancelStream.mockResolvedValue({ ...alreadyCanceledStream });

      const res = await request(app)
        .post("/api/streams/stream-cancel-003/cancel")
        .set("x-correlation-id", "corr-repeat-cancel");

      expect(res.status).toBe(200);
      const signal = getLastPublishedCancelStreamSignal();
      expect(signal).not.toBeNull();
      expect(signal?.outcome).toBe("already_canceled");
      expect(signal?.isRepeatedCancel).toBe(true);
      expect(signal?.isNormalEmpty).toBe(true);
      expect(signal?.streamId).toBe("stream-cancel-003");
    });

    it("emits already_completed signal when cancelling a completed stream", async () => {
      streamStoreMocks.getStream.mockReturnValue({ ...completedStream });
      streamStoreMocks.cancelStream.mockResolvedValue({
        ...completedStream,
        canceledAt: 1700002000,
      });

      const res = await request(app)
        .post("/api/streams/stream-cancel-002/cancel");

      expect(res.status).toBe(200);
      const signal = getLastPublishedCancelStreamSignal();
      expect(signal).not.toBeNull();
      expect(signal?.outcome).toBe("already_completed");
      expect(signal?.isNormalEmpty).toBe(true);
    });

    it("emits racing_claim signal when claimed amount advances during cancellation", async () => {
      streamStoreMocks.getStream.mockReturnValue({ ...activeStream, claimedAmount: 100 });
      streamStoreMocks.cancelStream.mockResolvedValue({
        ...activeStream,
        claimedAmount: 400, // Claim advanced concurrently
        canceledAt: 1700002000,
      });

      const res = await request(app)
        .post("/api/streams/stream-cancel-001/cancel");

      expect(res.status).toBe(200);
      const signal = getLastPublishedCancelStreamSignal();
      expect(signal).not.toBeNull();
      expect(signal?.outcome).toBe("racing_claim");
      expect(signal?.isRacingClaim).toBe(true);
    });

    it("emits failure signal when cancelStream throws an unexpected error", async () => {
      streamStoreMocks.getStream.mockReturnValue({ ...activeStream });
      streamStoreMocks.cancelStream.mockRejectedValue(new Error("Database transaction deadlock"));

      const res = await request(app)
        .post("/api/streams/stream-cancel-001/cancel")
        .set("x-request-id", "req-fail-deadlock");

      expect(res.status).toBe(500);
      const signal = getLastPublishedCancelStreamSignal();
      expect(signal).not.toBeNull();
      expect(signal?.outcome).toBe("failure");
      expect(signal?.isNormalEmpty).toBe(false);
      expect(signal?.requestId).toBe("req-fail-deadlock");
    });
  });
});
