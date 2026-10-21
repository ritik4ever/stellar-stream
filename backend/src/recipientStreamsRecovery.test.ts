import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import { Keypair } from "@stellar/stellar-sdk";
import { logger } from "./logger";

const SENDER = Keypair.random().publicKey();
const VALID_RECIPIENT = Keypair.random().publicKey();
const EMPTY_VALID_RECIPIENT = Keypair.random().publicKey();

function corruptStellarChecksum(validPublicKey: string): string {
  const lastChar = validPublicKey[validPublicKey.length - 1];
  const replacement = lastChar === "A" ? "B" : "A";
  return validPublicKey.slice(0, -1) + replacement;
}

const INVALID_CHECKSUM_RECIPIENT = corruptStellarChecksum(VALID_RECIPIENT);

const cacheMocks = vi.hoisted(() => ({
  getCache: vi.fn(() => ({
    get: vi.fn().mockResolvedValue(null),
    set: vi.fn().mockResolvedValue(undefined),
  })),
  initCache: vi.fn(),
}));

const streamStoreMocks = vi.hoisted(() => ({
  MIN_COMPARE_STREAMS: 2,
  MAX_COMPARE_STREAMS: 5,
  archiveOldStreams: vi.fn(),
  calculateProgress: vi.fn(),
  compareStreams: vi.fn(),
  cancelStream: vi.fn(),
  createStream: vi.fn(),
  deleteStreamById: vi.fn(),
  estimateCreateStreamFee: vi.fn(),
  getLatestLedgerTime: vi.fn(),
  getOnChainClaimableAmount: vi.fn(),
  getOnChainClaimableBatch: vi.fn(),
  getOnChainStreamCount: vi.fn(),
  getStream: vi.fn(),
  initSoroban: vi.fn(),
  listStreams: vi.fn(),
  listStreamsByRecipient: vi.fn(),
  listStreamsBySender: vi.fn(),
  markStreamComplete: vi.fn(),
  nowInSeconds: vi.fn(() => 1000),
  pauseStream: vi.fn(),
  reconcileStream: vi.fn(),
  refreshStreamStatuses: vi.fn(),
  resumeStream: vi.fn(),
  syncStreams: vi.fn(),
  updateStreamStartAt: vi.fn(),
}));

const eventHistoryMocks = vi.hoisted(() => ({
  countAllEvents: vi.fn(),
  countStreamEvents: vi.fn(),
  getAllEvents: vi.fn(),
  getGlobalEvents: vi.fn(),
  getStreamEventSummary: vi.fn(),
  getStreamHistory: vi.fn(),
  recordEvent: vi.fn(),
  recordEventWithDb: vi.fn(),
}));

vi.mock("./services/cache", () => cacheMocks);
vi.mock("./services/streamStore", () => streamStoreMocks);
vi.mock("./services/eventHistory", () => eventHistoryMocks);
vi.mock("./services/auth", () => ({
  authMiddleware: vi.fn((_req: any, _res: any, next: any) => next()),
  adminJwtAuth: vi.fn((_req: any, _res: any, next: any) => next()),
  generateChallenge: vi.fn(),
  refreshToken: vi.fn(),
  verifyChallengeAndIssueToken: vi.fn(),
  getJwtSecret: vi.fn(() => "test-secret"),
}));

import { app } from "./index";

const sampleStream = {
  id: "1",
  sender: SENDER,
  recipient: VALID_RECIPIENT,
  assetCode: "USDC",
  totalAmount: 100,
  durationSeconds: 100,
  startAt: 900,
  createdAt: 1000,
  pausedDuration: 0,
  cliffSeconds: 0,
};

const sampleProgress = {
  status: "active" as const,
  ratePerSecond: 1,
  elapsedSeconds: 50,
  vestedAmount: 50,
  remainingAmount: 50,
  percentComplete: 50,
};

describe("Recipient streams endpoint recovery & account validation (#1055)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    streamStoreMocks.calculateProgress.mockReturnValue(sampleProgress);
  });

  it("distinguishes invalid account checksum (400 VALIDATION_ERROR) from valid empty account (200 empty list)", async () => {
    const invalidRes1 = await request(app).get(
      `/api/recipients/${INVALID_CHECKSUM_RECIPIENT}/streams`,
    );
    expect(invalidRes1.status).toBe(400);
    expect(invalidRes1.body.code).toBe("VALIDATION_ERROR");
    expect(invalidRes1.body.error).toContain("must be a valid Stellar account ID");
    expect(streamStoreMocks.listStreamsByRecipient).not.toHaveBeenCalled();

    const invalidRes2 = await request(app).get(
      `/api/streams/recipient/${INVALID_CHECKSUM_RECIPIENT}`,
    );
    expect(invalidRes2.status).toBe(400);
    expect(invalidRes2.body.code).toBe("VALIDATION_ERROR");
    expect(streamStoreMocks.listStreamsByRecipient).not.toHaveBeenCalled();

    streamStoreMocks.listStreamsByRecipient.mockReturnValue([]);

    const infoSpy = vi.spyOn(logger, "info");
    const emptyRes1 = await request(app)
      .get(`/api/recipients/${EMPTY_VALID_RECIPIENT}/streams`)
      .set("X-Request-ID", "recipient-empty-query");
    expect(emptyRes1.status).toBe(200);
    expect(emptyRes1.headers["x-request-id"]).toBe("recipient-empty-query");
    expect(emptyRes1.body).toEqual({
      data: [],
      total: 0,
      page: 1,
      limit: 0,
    });
    expect(infoSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "recipient_stream_query",
        outcome: "empty",
        durationMs: expect.any(Number),
        attempts: 1,
        resultCount: 0,
      }),
      "recipient streams query completed",
    );

    const emptyRes2 = await request(app).get(
      `/api/streams/recipient/${EMPTY_VALID_RECIPIENT}`,
    );
    expect(emptyRes2.status).toBe(200);
    expect(emptyRes2.body).toEqual({
      data: [],
      total: 0,
      page: 1,
      limit: 0,
    });
  });

  it("retries once and recovers safely when database query timeout is transient", async () => {
    const timeoutErr = Object.assign(new Error("SQLITE_BUSY: database query timeout"), {
      code: "SQLITE_BUSY",
    });

    streamStoreMocks.listStreamsByRecipient
      .mockImplementationOnce(() => {
        throw timeoutErr;
      })
      .mockReturnValueOnce([sampleStream]);
    const infoSpy = vi.spyOn(logger, "info");

    const res = await request(app).get(
      `/api/recipients/${VALID_RECIPIENT}/streams`,
    );

    expect(res.status).toBe(200);
    expect(res.body.total).toBe(1);
    expect(res.body.data[0].id).toBe("1");
    expect(streamStoreMocks.listStreamsByRecipient).toHaveBeenCalledTimes(2);
    expect(infoSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "recipient_stream_query",
        outcome: "recovered_after_retry",
        attempts: 2,
        resultCount: 1,
      }),
      "recipient streams query completed",
    );
    expect(streamStoreMocks.createStream).not.toHaveBeenCalled();
    expect(eventHistoryMocks.recordEvent).not.toHaveBeenCalled();
  });

  it("returns 503 DATABASE_TIMEOUT when database query timeout persists across retry on both recipient endpoints", async () => {
    const timeoutErr = Object.assign(
      new Error("Database query timed out while reading streams"),
      { code: "ETIMEDOUT" },
    );
    streamStoreMocks.listStreamsByRecipient.mockImplementation(() => {
      throw timeoutErr;
    });
    const errorSpy = vi.spyOn(logger, "error");

    const res1 = await request(app).get(
      `/api/recipients/${VALID_RECIPIENT}/streams`,
    );
    expect(res1.status).toBe(503);
    expect(res1.body.code).toBe("DATABASE_TIMEOUT");
    expect(res1.body.error).toContain("Database query timed out");
    expect(streamStoreMocks.listStreamsByRecipient).toHaveBeenCalledTimes(2);
    expect(errorSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        operation: "recipient_stream_query",
        outcome: "timeout",
        durationMs: expect.any(Number),
        attempts: 2,
        errorCode: "DATABASE_TIMEOUT",
      }),
      "recipient streams query failed",
    );
    expect(errorSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ accountId: VALID_RECIPIENT }),
      expect.anything(),
    );

    streamStoreMocks.listStreamsByRecipient.mockClear();

    const res2 = await request(app).get(
      `/api/streams/recipient/${VALID_RECIPIENT}`,
    );
    expect(res2.status).toBe(503);
    expect(res2.body.code).toBe("DATABASE_TIMEOUT");
    // Cache fallback also invokes fetcher, each with 1 timeout retry
    expect(streamStoreMocks.listStreamsByRecipient).toHaveBeenCalled();
    expect(eventHistoryMocks.recordEventWithDb).not.toHaveBeenCalled();
  });
});
