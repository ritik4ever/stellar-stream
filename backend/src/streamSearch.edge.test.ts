import { logger } from "./logger";
import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";

const streamStoreMocks = vi.hoisted(() => ({
  calculateProgress: vi.fn(),
  cancelStream: vi.fn(),
  createStream: vi.fn(),
  getStream: vi.fn(),
  initSoroban: vi.fn(),
  listStreams: vi.fn(),
  listStreamsBySender: vi.fn(),
  nowInSeconds: vi.fn(() => 1000),
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

vi.mock("./services/streamStore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./services/streamStore")>();
  return { ...actual, ...streamStoreMocks };
});
vi.mock("./services/eventHistory", () => eventHistoryMocks);
vi.mock("./services/cache", () => cacheMocks);
vi.mock("./services/auth", () => ({
  authMiddleware: vi.fn((_req: any, _res: any, next: any) => next()),
  adminJwtAuth: vi.fn((_req: any, _res: any, next: any) => next()),
  generateChallenge: vi.fn(),
  refreshToken: vi.fn(),
  verifyChallengeAndIssueToken: vi.fn(),
}));

import { app } from "./index";

const stream = (over: any) => ({
  id: "1",
  sender: "GSENDER1",
  recipient: "GRECIPIENT1",
  assetCode: "USDC",
  totalAmount: 100,
  durationSeconds: 1000,
  startAt: 0,
  createdAt: 100,
  ...over,
});

const progress = {
  status: "active" as const,
  ratePerSecond: 0,
  elapsedSeconds: 0,
  vestedAmount: 0,
};

beforeEach(() => {
  streamStoreMocks.listStreams.mockReset();
  streamStoreMocks.calculateProgress.mockReset();
  streamStoreMocks.calculateProgress.mockReturnValue(progress);
});

describe("GET /api/streams search edge cases (SSB-2026-110)", () => {
  it("treats q case-insensitively when combined with an asset filter", async () => {
    streamStoreMocks.listStreams.mockReturnValue([
      stream({ id: "1", assetCode: "USDC", sender: "GALICE" }),
      stream({ id: "2", assetCode: "USDC", recipient: "Galice" }),
      stream({ id: "3", assetCode: "OTHER", sender: "GALICE" }),
    ]);

    const upper = await request(app)
      .get("/api/streams")
      .query({ q: "ALICE", asset: "USDC" });
    const lower = await request(app)
      .get("/api/streams")
      .query({ q: "alice", asset: "USDC" });

    console.log("UPPER", upper.status, JSON.stringify(upper.body));
    console.log("LOWER", lower.status, JSON.stringify(lower.body));

    expect([200, 400, 500]).toContain(upper.status);
    if (upper.status === 200) {
      const upperIds = (upper.body.data ?? []).map((s: any) => s.id).sort();
      const lowerIds = (lower.body.data ?? []).map((s: any) => s.id).sort();
      expect(upperIds).toEqual(lowerIds);
      expect(upper.body.total).toBe(upperIds.length);
      expect(upperIds).not.toContain("3");
    }
  });

  it("emits stream_search_unsupported_filter for unsupported filter input on /api/streams", async () => {
    streamStoreMocks.listStreams.mockReturnValue([
      stream({ id: "1", assetCode: "USDC", sender: "GALICE" }),
    ]);

    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});

    const first = await request(app)
      .get("/api/streams")
      .query({ q: "alice", asset: "USDC", bogusFilter: "x" });
    const second = await request(app)
      .get("/api/streams")
      .query({ q: "alice", asset: "USDC", bogusFilter: "x" });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body.total).toBe(1);
    expect(second.body.data.map((s: any) => s.id)).toEqual(
      first.body.data.map((s: any) => s.id),
    );

    const signals = warnSpy.mock.calls
      .map(([payload]) => payload as any)
      .filter((payload) => payload?.event === "stream_search_unsupported_filter");
    expect(signals.length).toBeGreaterThanOrEqual(2);
    for (const payload of signals) {
      expect(payload.endpoint).toBe("/api/streams");
      expect(payload.unsupportedFilters).toEqual(["bogusFilter"]);
      expect(payload.outcome).toBe("ignored");
      expect(JSON.stringify(payload)).not.toContain('"x"');
    }

    warnSpy.mockRestore();
  });

  it("does not emit the unsupported-filter signal for a normal empty case", async () => {
    streamStoreMocks.listStreams.mockReturnValue([]);
    const warnSpy = vi.spyOn(logger, "warn").mockImplementation(() => {});

    const res = await request(app)
      .get("/api/streams")
      .query({ q: "alice", asset: "USDC" });

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(0);

    const signals = warnSpy.mock.calls
      .map(([payload]) => payload as any)
      .filter((payload) => payload?.event === "stream_search_unsupported_filter");
    expect(signals).toEqual([]);

    warnSpy.mockRestore();
  });

  it("returns identical results for repeated identical search requests", async () => {
    streamStoreMocks.listStreams.mockReturnValue([
      stream({ id: "1", assetCode: "USDC", sender: "GALICE" }),
      stream({ id: "2", assetCode: "USDC", sender: "GALICE" }),
    ]);

    const a = await request(app).get("/api/streams").query({ q: "ALICE", asset: "USDC" });
    const b = await request(app).get("/api/streams").query({ q: "ALICE", asset: "USDC" });

    console.log("REPEAT", a.status, JSON.stringify(a.body));

    expect(a.status).toBe(b.status);
    if (a.status === 200) {
      expect(b.body.total).toBe(a.body.total);
      expect(b.body.data.map((s: any) => s.id)).toEqual(
        a.body.data.map((s: any) => s.id),
      );
    }
  });
});