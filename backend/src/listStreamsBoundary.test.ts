import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

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
  {
    id: "stream-002",
    sender: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    recipient: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
    assetCode: "USDC",
    totalAmount: 2000,
    durationSeconds: 7200,
    startAt: 1700001000,
    createdAt: 1700001000,
  },
  {
    id: "stream-003",
    sender: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    recipient: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
    assetCode: "XLM",
    totalAmount: 3000,
    durationSeconds: 3600,
    startAt: 1700002000,
    createdAt: 1700002000,
  },
  {
    id: "stream-004",
    sender: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    recipient: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
    assetCode: "USDC",
    totalAmount: 4000,
    durationSeconds: 14400,
    startAt: 1700003000,
    createdAt: 1700003000,
  },
  {
    id: "stream-005",
    sender: "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
    recipient: "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
    assetCode: "USDC",
    totalAmount: 5000,
    durationSeconds: 86400,
    startAt: 1700004000,
    createdAt: 1700004000,
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

describe("GET /api/streams Boundary Behavior & Pagination Recovery (SSB-2026-105)", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    streamStoreMocks.listStreams.mockReturnValue([...mockStreams]);
  });

  describe("Documented bounds for page and limit", () => {
    it("returns HTTP 200 with minimal valid bounds (page=1, limit=1)", async () => {
      const res = await request(app).get("/api/streams?page=1&limit=1");
      expect(res.status).toBe(200);
      expect(res.body.page).toBe(1);
      expect(res.body.limit).toBe(1);
      expect(res.body.total).toBe(5);
      expect(res.body.data).toHaveLength(1);
      expect(res.body.data[0].id).toBe("stream-001");
    });

    it("returns HTTP 200 with maximum valid limit (page=1, limit=100)", async () => {
      const res = await request(app).get("/api/streams?page=1&limit=100");
      expect(res.status).toBe(200);
      expect(res.body.page).toBe(1);
      expect(res.body.limit).toBe(100);
      expect(res.body.total).toBe(5);
      expect(res.body.data).toHaveLength(5);
    });

    it("rejects boundary violation below minimum page (page=0) with 400 Bad Request", async () => {
      const res = await request(app).get("/api/streams?page=0&limit=10");
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("VALIDATION_ERROR");
      expect(res.body.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            message: "page must be greater than or equal to 1",
          }),
        ]),
      );
    });

    it("rejects negative page (page=-1) with 400 Bad Request", async () => {
      const res = await request(app).get("/api/streams?page=-1&limit=10");
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("VALIDATION_ERROR");
    });

    it("rejects boundary violation below minimum limit (limit=0) with 400 Bad Request", async () => {
      const res = await request(app).get("/api/streams?page=1&limit=0");
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("VALIDATION_ERROR");
    });

    it("rejects boundary violation above maximum limit (limit=101) with 400 Bad Request", async () => {
      const res = await request(app).get("/api/streams?page=1&limit=101");
      expect(res.status).toBe(400);
      expect(res.body.error).toBe("VALIDATION_ERROR");
      expect(res.body.details).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            message: "limit must be less than or equal to 100",
          }),
        ]),
      );
    });

    it("returns HTTP 200 with empty data array when page exceeds total records (page=99, limit=10)", async () => {
      const res = await request(app).get("/api/streams?page=99&limit=10");
      expect(res.status).toBe(200);
      expect(res.body.page).toBe(99);
      expect(res.body.limit).toBe(10);
      expect(res.body.total).toBe(5);
      expect(res.body.data).toHaveLength(0);
    });
  });

  describe("Stable row order and total count invariants", () => {
    it("preserves stable row order and total count across consecutive pagination slices", async () => {
      // Page 1 with limit 2
      const resPage1 = await request(app).get("/api/streams?page=1&limit=2");
      expect(resPage1.status).toBe(200);
      expect(resPage1.body.data).toHaveLength(2);
      expect(resPage1.body.total).toBe(5);

      // Page 2 with limit 2
      const resPage2 = await request(app).get("/api/streams?page=2&limit=2");
      expect(resPage2.status).toBe(200);
      expect(resPage2.body.data).toHaveLength(2);
      expect(resPage2.body.total).toBe(5);

      // Ensure no rows overlap between page 1 and page 2
      const idsPage1 = resPage1.body.data.map((s: any) => s.id);
      const idsPage2 = resPage2.body.data.map((s: any) => s.id);
      const overlap = idsPage1.filter((id: string) => idsPage2.includes(id));
      expect(overlap).toHaveLength(0);
      expect(idsPage1).toEqual(["stream-001", "stream-002"]);
      expect(idsPage2).toEqual(["stream-003", "stream-004"]);
    });
  });

  describe("Database read failure during pagination", () => {
    it("catches database read failure during pagination and returns HTTP 500 without crashing", async () => {
      streamStoreMocks.listStreams.mockImplementationOnce(() => {
        throw new Error("Sqlite database read timeout / I/O error");
      });

      const res = await request(app).get("/api/streams?page=1&limit=20");
      expect(res.status).toBe(500);
      expect(res.body).toMatchObject({
        error: "Failed to retrieve streams.",
        code: "INTERNAL_ERROR",
      });
    });
  });
});
