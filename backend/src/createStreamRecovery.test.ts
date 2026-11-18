import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import { Keypair } from "@stellar/stellar-sdk";

const SENDER_A = Keypair.random().publicKey();
const RECIPIENT_1 = Keypair.random().publicKey();

const mockStream = {
  id: "stream-recovery-1034",
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
}));

const sorobanMocks = vi.hoisted(() => ({
  getServer: vi.fn(),
  getNetworkPassphrase: vi.fn(),
}));

vi.mock("./services/streamStore", () => streamStoreMocks);
vi.mock("./services/cache", () => cacheMocks);
vi.mock("./services/eventHistory", () => eventHistoryMocks);
vi.mock("./services/db", () => dbMocks);
vi.mock("./services/soroban", () => sorobanMocks);

describe("Create stream endpoint recovery and concurrency (SSB-2026-092)", () => {
  let app: any;

  beforeEach(async () => {
    vi.clearAllMocks();
    streamStoreMocks.createStream.mockReset();
    const { resetStreamIdempotencyForTesting } = await import(
      "./services/streamIdempotency"
    );
    resetStreamIdempotencyForTesting();
    const indexModule = await import("./index");
    app = indexModule.default;
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

  describe("Repeat POST after a client timeout", () => {
    it("safely recovers from client timeout without duplicating money-moving side-effects", async () => {
      const idempotencyKey = "recovery-timeout-key-1";

      // Attempt 1: Server processes successfully, but client connection drops before response is read
      const res1 = await request(app)
        .post("/api/streams")
        .set("idempotency-key", idempotencyKey)
        .send(validPayload);

      expect(res1.status).toBe(201);
      expect(res1.body.data.id).toBe("stream-recovery-1034");
      expect(streamStoreMocks.createStream).toHaveBeenCalledTimes(1);

      // Attempt 2: Client retries after timeout with the identical idempotency key
      const res2 = await request(app)
        .post("/api/streams")
        .set("idempotency-key", idempotencyKey)
        .send(validPayload);

      expect(res2.status).toBe(200);
      expect(res2.headers["x-idempotent-replay"]).toBe("true");
      expect(res2.body.data.id).toBe("stream-recovery-1034");
      expect(res2.body.data.totalAmount).toBe(1000);

      // Acceptance criterion: Recovery does not duplicate money-moving effects, events, or stored state
      expect(streamStoreMocks.createStream).toHaveBeenCalledTimes(1);
    });
  });

  describe("Two identical requests arriving together (concurrent collision & rollback)", () => {
    it("handles concurrent collision cleanly with HTTP 409 and executes createStream exactly once", async () => {
      const idempotencyKey = "recovery-race-key-1";

      let resolveCreate: (val: any) => void;
      const delayedPromise = new Promise((resolve) => {
        resolveCreate = resolve;
      });
      streamStoreMocks.createStream.mockReturnValueOnce(delayedPromise);

      // Dispatch request 1
      const req1Promise = request(app)
        .post("/api/streams")
        .set("idempotency-key", idempotencyKey)
        .send(validPayload);

      // Allow tick for request 1 to mark key in-flight
      await new Promise((r) => setTimeout(r, 10));

      // Dispatch simultaneous identical request 2
      const res2 = await request(app)
        .post("/api/streams")
        .set("idempotency-key", idempotencyKey)
        .send(validPayload);

      // Request 2 must fail fast with 409 Conflict without duplicate execution
      expect(res2.status).toBe(409);
      expect(res2.body.error).toMatch(/currently in flight/i);
      expect(res2.body.code).toBe("CONFLICT");

      // Resolve request 1
      resolveCreate!({ ...mockStream });
      const res1 = await req1Promise;

      expect(res1.status).toBe(201);
      expect(streamStoreMocks.createStream).toHaveBeenCalledTimes(1);
    });

    it("releases in-flight lock on failure allowing safe retry without persistent lockup", async () => {
      const idempotencyKey = "recovery-fail-retry-key";

      // Attempt 1: Transient RPC or network failure occurs during stream creation
      streamStoreMocks.createStream.mockRejectedValueOnce(
        new Error("Stellar RPC connection timeout")
      );

      const res1 = await request(app)
        .post("/api/streams")
        .set("idempotency-key", idempotencyKey)
        .send(validPayload);

      expect(res1.status).toBe(500);

      // Attempt 2: Client retries after backoff. The lock must have been released in finally block
      streamStoreMocks.createStream.mockResolvedValueOnce({ ...mockStream });

      const res2 = await request(app)
        .post("/api/streams")
        .set("idempotency-key", idempotencyKey)
        .send(validPayload);

      expect(res2.status).toBe(201);
      expect(res2.body.data.id).toBe("stream-recovery-1034");
      expect(streamStoreMocks.createStream).toHaveBeenCalledTimes(2);
    });
  });
});
