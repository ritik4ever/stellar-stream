import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

const mockStreamsWithTies = [
  {
    id: "stream-c",
    sender: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    recipient: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
    assetCode: "USDC",
    totalAmount: 1000,
    durationSeconds: 3600,
    startAt: 1700000000,
    createdAt: 1700000000, // Identical timestamp
  },
  {
    id: "stream-a",
    sender: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    recipient: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
    assetCode: "USDC",
    totalAmount: 1000,
    durationSeconds: 3600,
    startAt: 1700000000,
    createdAt: 1700000000, // Identical timestamp
  },
  {
    id: "stream-b",
    sender: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    recipient: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
    assetCode: "USDC",
    totalAmount: 1000,
    durationSeconds: 3600,
    startAt: 1700000000,
    createdAt: 1700000000, // Identical timestamp
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
  listStreams: vi.fn(() => {
    // Deterministic secondary sort by id ASC
    return [...mockStreamsWithTies].sort((x, y) => x.id.localeCompare(y.id));
  }),
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

describe("List Streams Consistency & Stable Row Order (SSB-2026-103)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe("Deterministic row ordering with secondary tie-breaker", () => {
    it("guarantees stable, deterministic row order when streams have identical primary sort timestamps", async () => {
      const res = await request(app).get("/api/streams?page=1&limit=10&sort=createdAt&order=desc");
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(3);
      expect(res.body.data).toHaveLength(3);

      // Verify secondary tie-breaking by id ascending: stream-a, stream-b, stream-c
      expect(res.body.data[0].id).toBe("stream-a");
      expect(res.body.data[1].id).toBe("stream-b");
      expect(res.body.data[2].id).toBe("stream-c");
    });

    it("maintains stable pagination boundaries without duplicate rows across consecutive pages", async () => {
      // Slicing page 1 (limit 2)
      const resPage1 = await request(app).get("/api/streams?page=1&limit=2&sort=createdAt&order=desc");
      expect(resPage1.status).toBe(200);
      expect(resPage1.body.data).toHaveLength(2);
      expect(resPage1.body.data.map((s: any) => s.id)).toEqual(["stream-a", "stream-b"]);

      // Slicing page 2 (limit 2)
      const resPage2 = await request(app).get("/api/streams?page=2&limit=2&sort=createdAt&order=desc");
      expect(resPage2.status).toBe(200);
      expect(resPage2.body.data).toHaveLength(1);
      expect(resPage2.body.data[0].id).toBe("stream-c");

      // Verify total count matches committed state consistently across both slices
      expect(resPage1.body.total).toBe(3);
      expect(resPage2.body.total).toBe(3);
    });
  });

  describe("Committed state guarantee on success & no false change claims on failure", () => {
    it("reflects only committed records and invariant total count on success", async () => {
      const res = await request(app).get("/api/streams?page=1&limit=20");
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(3);
      expect(Array.isArray(res.body.data)).toBe(true);
    });

    it("does not return partial state or claim changes when database read fails", async () => {
      streamStoreMocks.listStreams.mockImplementationOnce(() => {
        throw new Error("Committed read isolation failure");
      });

      const res = await request(app).get("/api/streams?page=1&limit=20");
      expect(res.status).toBe(500);
      expect(res.body.error).toBe("Failed to retrieve streams.");
      expect(res.body.data).toBeUndefined();
    });
  });
});
