import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import {
  emitListStreamsSignal,
  getLastPublishedListStreamsSignal,
  resetListStreamsSignalForTesting,
  LIST_STREAMS_OUTCOME_CODES,
} from "./listStreamsOutcome";
import { logger } from "../logger";

const mockStreams = [
  {
    id: "stream-001",
    sender: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    recipient: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
    assetCode: "USDC",
    totalAmount: 1000,
    durationSeconds: 3600,
    startAt: 1700000000,
    createdAt: 1700000000,
  },
];

const streamStoreMocks = vi.hoisted(() => ({
  calculateProgress: vi.fn((stream: any) => ({
    status: "active",
    ratePerSecond: 1.0,
    elapsedSeconds: 500,
    vestedAmount: 500,
    remainingAmount: stream.totalAmount - 500,
    percentComplete: 50,
  })),
  cancelStream: vi.fn(),
  createStream: vi.fn(),
  getStream: vi.fn(),
  initSoroban: vi.fn(),
  listStreams: vi.fn(() => [...mockStreams]),
  listStreamsBySender: vi.fn(),
  nowInSeconds: vi.fn(() => 1700005000),
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
  authMiddleware: vi.fn((req: any, res: any, next: any) => next()),
  adminJwtAuth: vi.fn((req: any, res: any, next: any) => next()),
  generateToken: vi.fn(() => "mock_token"),
  verifyToken: vi.fn(() => ({ role: "admin" })),
}));
vi.mock("./indexer", () => ({
  initIndexer: vi.fn(),
  startIndexer: vi.fn(),
  stopIndexer: vi.fn(),
  getCircuitBreakerStatus: vi.fn(() => ({ state: "closed", failures: 0 })),
}));

import { app } from "../index";

describe("List Streams Observability Signals (SSB-2026-104)", () => {
  beforeEach(() => {
    resetListStreamsSignalForTesting();
    vi.clearAllMocks();
    streamStoreMocks.listStreams.mockReturnValue([...mockStreams]);
  });

  describe("Signal emission and classification unit behavior", () => {
    it("emits success outcome signal with code 0 and isNormalEmpty=false when streams exist", () => {
      const signal = emitListStreamsSignal({
        outcome: "success",
        detail: "Stream list query retrieved successfully.",
        isNormalEmpty: false,
        latencyMs: 12,
        page: 1,
        limit: 20,
        total: 10,
        returnedCount: 10,
        requestId: "req-12345",
      });

      expect(signal.outcome).toBe("success");
      expect(signal.outcomeCode).toBe(LIST_STREAMS_OUTCOME_CODES.success);
      expect(signal.isNormalEmpty).toBe(false);
      expect(signal.requestId).toBe("req-12345");
      expect(getLastPublishedListStreamsSignal()).toEqual(signal);
    });

    it("distinguishes normal empty case with isNormalEmpty=true and outcome=success", () => {
      const signal = emitListStreamsSignal({
        outcome: "success",
        detail: "Normal empty stream list query.",
        isNormalEmpty: true,
        latencyMs: 8,
        page: 1,
        limit: 20,
        total: 0,
        returnedCount: 0,
        requestId: "req-empty-001",
      });

      expect(signal.outcome).toBe("success");
      expect(signal.outcomeCode).toBe(0);
      expect(signal.isNormalEmpty).toBe(true);
      expect(signal.total).toBe(0);
    });

    it("emits failure outcome signal with code 2 on database read failure without credentials", () => {
      const loggerErrorSpy = vi.spyOn(logger, "error");

      const signal = emitListStreamsSignal({
        outcome: "failure",
        detail: "Database read failure during pagination.",
        isNormalEmpty: false,
        latencyMs: 45,
        page: 1,
        limit: 20,
        total: 0,
        returnedCount: 0,
        requestId: "req-err-999",
      });

      expect(signal.outcome).toBe("failure");
      expect(signal.outcomeCode).toBe(LIST_STREAMS_OUTCOME_CODES.failure);
      expect(signal.isNormalEmpty).toBe(false);
      expect(loggerErrorSpy).toHaveBeenCalled();
    });
  });

  describe("Integration with GET /api/streams endpoint", () => {
    it("surfaces success signal and links request ID when querying streams", async () => {
      const res = await request(app)
        .get("/api/streams?page=1&limit=20")
        .set("X-Request-ID", "client-req-abc-123");

      expect(res.status).toBe(200);
      const signal = getLastPublishedListStreamsSignal();
      expect(signal).not.toBeNull();
      expect(signal?.outcome).toBe("success");
      expect(signal?.isNormalEmpty).toBe(false);
      expect(signal?.requestId).toBe("client-req-abc-123");
      expect(signal?.returnedCount).toBe(1);
    });

    it("surfaces normal empty signal when no streams match query", async () => {
      streamStoreMocks.listStreams.mockReturnValue([]);

      const res = await request(app)
        .get("/api/streams?page=1&limit=20")
        .set("X-Request-ID", "empty-query-req");

      expect(res.status).toBe(200);
      const signal = getLastPublishedListStreamsSignal();
      expect(signal).not.toBeNull();
      expect(signal?.outcome).toBe("success");
      expect(signal?.isNormalEmpty).toBe(true);
      expect(signal?.total).toBe(0);
      expect(signal?.requestId).toBe("empty-query-req");
    });

    it("surfaces failure signal with latency when database read throws during pagination", async () => {
      streamStoreMocks.listStreams.mockImplementationOnce(() => {
        throw new Error("Sqlite disk I/O timeout");
      });

      const res = await request(app)
        .get("/api/streams?page=1&limit=20")
        .set("X-Request-ID", "failing-db-req");

      expect(res.status).toBe(500);
      const signal = getLastPublishedListStreamsSignal();
      expect(signal).not.toBeNull();
      expect(signal?.outcome).toBe("failure");
      expect(signal?.isNormalEmpty).toBe(false);
      expect(signal?.requestId).toBe("failing-db-req");
      expect(signal?.detail).toContain("Database read failure during pagination");
    });
  });
});
