import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import { Keypair } from "@stellar/stellar-sdk";

const SENDER_A = Keypair.random().publicKey();
const RECIPIENT_1 = Keypair.random().publicKey();

const streamStoreMocks = vi.hoisted(() => ({
  calculateProgress: vi.fn((stream: any) => ({
    status: "scheduled",
    ratePerSecond: 1.25,
    elapsedSeconds: 0,
    vestedAmount: 0,
    remainingAmount: stream.totalAmount,
    percentComplete: 0,
  })),
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
vi.mock("./services/eventHistory", () => eventHistoryMocks);
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
import { resetStreamIdempotencyForTesting } from "./services/streamIdempotency";

describe("POST /api/streams boundary behavior (SSB-2026-091)", () => {
  let validPayload: any;
  let createdStream: any;

  beforeEach(() => {
    resetStreamIdempotencyForTesting();
    vi.clearAllMocks();

    validPayload = {
      sender: SENDER_A,
      recipient: RECIPIENT_1,
      assetCode: "USDC",
      totalAmount: 150,
      durationSeconds: 120,
    };

    createdStream = {
      id: "101",
      ...validPayload,
      startAt: 1700000000,
      createdAt: 1700000000,
    };

    streamStoreMocks.createStream.mockResolvedValue(createdStream);
    streamStoreMocks.getStream.mockReturnValue(createdStream);
  });

  it("creates a new stream with 201 Created on first invocation", async () => {
    const res = await request(app)
      .post("/api/streams")
      .set("Authorization", "Bearer mock_token")
      .send(validPayload);

    expect(res.status).toBe(201);
    expect(res.body.data.id).toBe("101");
    expect(streamStoreMocks.createStream).toHaveBeenCalledTimes(1);
  });

  it("handles repeat POST after client timeout with deterministic 200 OK and replay header", async () => {
    // Initial request succeeds
    const firstRes = await request(app)
      .post("/api/streams")
      .set("Authorization", "Bearer mock_token")
      .set("Idempotency-Key", "timeout-retry-key-1")
      .send(validPayload);

    expect(firstRes.status).toBe(201);
    expect(streamStoreMocks.createStream).toHaveBeenCalledTimes(1);

    // Client timed out reading first response and replays the request
    const retryRes = await request(app)
      .post("/api/streams")
      .set("Authorization", "Bearer mock_token")
      .set("Idempotency-Key", "timeout-retry-key-1")
      .send(validPayload);

    expect(retryRes.status).toBe(200);
    expect(retryRes.headers["x-idempotent-replay"]).toBe("true");
    expect(retryRes.body.data.id).toBe("101");
    // Crucial: createStream is NOT called a second time
    expect(streamStoreMocks.createStream).toHaveBeenCalledTimes(1);
  });

  it("handles repeat POST using payload fingerprint when explicit header is absent", async () => {
    const firstRes = await request(app)
      .post("/api/streams")
      .set("Authorization", "Bearer mock_token")
      .send(validPayload);

    expect(firstRes.status).toBe(201);
    expect(streamStoreMocks.createStream).toHaveBeenCalledTimes(1);

    const retryRes = await request(app)
      .post("/api/streams")
      .set("Authorization", "Bearer mock_token")
      .send(validPayload);

    expect(retryRes.status).toBe(200);
    expect(retryRes.headers["x-idempotent-replay"]).toBe("true");
    expect(retryRes.body.data.id).toBe("101");
    expect(streamStoreMocks.createStream).toHaveBeenCalledTimes(1);
  });

  it("handles two identical requests arriving together with 409 Conflict for in-flight request", async () => {
    let finishFirstRequest!: () => void;
    streamStoreMocks.createStream.mockImplementation(
      () =>
        new Promise((resolve) => {
          finishFirstRequest = () => resolve(createdStream);
        }),
    );

    // Fire first request (leaves in-flight)
    const req1 = request(app)
      .post("/api/streams")
      .set("Authorization", "Bearer mock_token")
      .set("Idempotency-Key", "concurrent-key-1")
      .send(validPayload);

    // Give req1 a moment to register in-flight
    await new Promise((r) => setTimeout(r, 20));

    // Fire identical concurrent request
    const req2 = await request(app)
      .post("/api/streams")
      .set("Authorization", "Bearer mock_token")
      .set("Idempotency-Key", "concurrent-key-1")
      .send(validPayload);

    expect(req2.status).toBe(409);
    expect(req2.body.code).toBe("CONFLICT");
    expect(req2.body.error).toContain("currently in flight");

    // Complete first request
    finishFirstRequest();
    const res1 = await req1;
    expect(res1.status).toBe(201);
  });
});
