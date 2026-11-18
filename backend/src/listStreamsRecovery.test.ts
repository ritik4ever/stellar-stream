import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

const SENDER = "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
const RECIPIENT = "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB";

const committedStreams = [
  {
    id: "stream-1",
    sender: SENDER,
    recipient: RECIPIENT,
    assetCode: "USDC",
    totalAmount: 1000,
    durationSeconds: 3600,
    startAt: 1700000000,
    createdAt: 1700000000,
    claimedAmount: 0,
  },
  {
    id: "stream-2",
    sender: SENDER,
    recipient: RECIPIENT,
    assetCode: "XLM",
    totalAmount: 2000,
    durationSeconds: 7200,
    startAt: 1700001000,
    createdAt: 1700001000,
    claimedAmount: 500,
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
  listStreams: vi.fn(() => [...committedStreams]),
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

vi.mock("./services/streamStore", () => streamStoreMocks);
vi.mock("./services/cache", () => cacheMocks);
vi.mock("./services/db", () => dbMocks);
vi.mock("./services/auth", () => ({
  authMiddleware: vi.fn((req: any, res: any, next: any) => next()),
  adminJwtAuth: vi.fn((req: any, res: any, next: any) => next()),
  generateToken: vi.fn(() => "mock_token"),
  verifyToken: vi.fn(() => ({ role: "admin" })),
}));
vi.mock("./services/indexer", () => ({
  initIndexer: vi.fn(),
  startIndexer: vi.fn(),
  stopIndexer: vi.fn(),
  getCircuitBreakerStatus: vi.fn(() => ({ state: "closed", failures: 0 })),
}));

import { app } from "./index";

describe("List Streams Endpoint Failure Recovery & Idempotent Retry (SSB-2026-102)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    streamStoreMocks.listStreams.mockReturnValue([...committedStreams]);
  });

  describe("Database read failure during pagination recovery", () => {
    it("handles transient database read failure gracefully without mutating state or money-moving effects", async () => {
      // Simulate transient read failure
      streamStoreMocks.listStreams.mockImplementationOnce(() => {
        throw new Error("Transient SQLite disk lock / read timeout");
      });

      const failureRes = await request(app).get("/api/streams?page=1&limit=10");
      expect(failureRes.status).toBe(500);
      expect(failureRes.body).toMatchObject({
        error: "Failed to retrieve streams.",
        code: "INTERNAL_ERROR",
      });

      // Verify no money-moving effects, events, or state changes were triggered
      expect(streamStoreMocks.cancelStream).not.toHaveBeenCalled();
      expect(streamStoreMocks.createStream).not.toHaveBeenCalled();

      // Subsequent retry succeeds cleanly and returns committed records
      const retryRes = await request(app).get("/api/streams?page=1&limit=10");
      expect(retryRes.status).toBe(200);
      expect(retryRes.body.total).toBe(2);
      expect(retryRes.body.data).toHaveLength(2);
      expect(retryRes.body.data[0].id).toBe("stream-1");
      expect(retryRes.body.data[1].id).toBe("stream-2");
    });

    it("ensures repeated retries after read recovery do not duplicate stored state or pagination slices", async () => {
      // First successful read
      const res1 = await request(app).get("/api/streams?page=1&limit=1");
      expect(res1.status).toBe(200);
      expect(res1.body.data).toHaveLength(1);
      expect(res1.body.data[0].id).toBe("stream-1");

      // Intermediate failure
      streamStoreMocks.listStreams.mockImplementationOnce(() => {
        throw new Error("I/O error during slice evaluation");
      });
      const errRes = await request(app).get("/api/streams?page=2&limit=1");
      expect(errRes.status).toBe(500);

      // Re-read page 2 after recovery
      const res2 = await request(app).get("/api/streams?page=2&limit=1");
      expect(res2.status).toBe(200);
      expect(res2.body.data).toHaveLength(1);
      expect(res2.body.data[0].id).toBe("stream-2");

      // Verify page 1 and page 2 remain strictly non-overlapping and mutually exclusive
      expect(res1.body.data[0].id).not.toBe(res2.body.data[0].id);
      expect(res2.body.total).toBe(2);
    });
  });
});
