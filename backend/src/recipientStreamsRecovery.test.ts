import { describe, it, expect, beforeEach, vi } from "vitest";
import request from "supertest";
import { Keypair } from "@stellar/stellar-sdk";

const SENDER = Keypair.random().publicKey();
const VALID_RECIPIENT = Keypair.random().publicKey();
const EMPTY_VALID_RECIPIENT = Keypair.random().publicKey();
const OTHER_RECIPIENT = Keypair.random().publicKey();

function corruptStellarChecksum(validPublicKey: string): string {
  const lastChar = validPublicKey[validPublicKey.length - 1];
  const replacement = lastChar === "A" ? "B" : "A";
  return validPublicKey.slice(0, -1) + replacement;
}

const INVALID_CHECKSUM_RECIPIENT = corruptStellarChecksum(VALID_RECIPIENT);

const cacheGetMock = vi.hoisted(() => vi.fn().mockResolvedValue(null));
const cacheSetMock = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

const cacheMocks = vi.hoisted(() => ({
  getCache: vi.fn(() => ({
    get: cacheGetMock,
    set: cacheSetMock,
  })),
  initCache: vi.fn(),
  invalidateCacheSync: vi.fn(),
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

const indexerMocks = vi.hoisted(() => ({
  initIndexer: vi.fn(),
  startIndexer: vi.fn(),
  stopIndexer: vi.fn(),
  getCircuitBreakerStatus: vi.fn(() => ({ state: "closed", failures: 0 })),
}));

const rpcDouble = vi.hoisted(() => ({
  getAccount: vi.fn(),
  simulateTransaction: vi.fn(),
  sendTransaction: vi.fn(),
  getLatestLedger: vi.fn(),
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
vi.mock("./services/db", () => dbMocks);
vi.mock("./services/indexer", () => indexerMocks);
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

const otherRecipientStream = {
  id: "2",
  sender: SENDER,
  recipient: OTHER_RECIPIENT,
  assetCode: "XLM",
  totalAmount: 300,
  durationSeconds: 300,
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

describe("Recipient streams endpoint recovery & account validation (#1055 / SSB-2026-115)", () => {
  let dbTableDouble: Array<typeof sampleStream>;

  beforeEach(() => {
    vi.clearAllMocks();
    cacheGetMock.mockResolvedValue(null);
    cacheSetMock.mockResolvedValue(undefined);
    streamStoreMocks.calculateProgress.mockReturnValue(sampleProgress);

    dbTableDouble = [{ ...sampleStream }, { ...otherRecipientStream }];
    streamStoreMocks.listStreamsByRecipient.mockImplementation(
      (recipientAddress: string) =>
        dbTableDouble.filter((row) => row.recipient === recipientAddress),
    );
  });

  it("distinguishes invalid account checksum (400 VALIDATION_ERROR) from valid empty account (200 empty list) while keeping stored recipient streams intact", async () => {
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
    expect(cacheGetMock).not.toHaveBeenCalled();

    const emptyRes1 = await request(app).get(
      `/api/recipients/${EMPTY_VALID_RECIPIENT}/streams`,
    );
    expect(emptyRes1.status).toBe(200);
    expect(emptyRes1.body).toEqual({
      data: [],
      total: 0,
      page: 1,
      limit: 0,
    });

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

    // Verify stored recipient-specific results are untouched and properly scoped
    expect(dbTableDouble).toHaveLength(2);
    const validRes = await request(app).get(
      `/api/recipients/${VALID_RECIPIENT}/streams`,
    );
    expect(validRes.status).toBe(200);
    expect(validRes.body.total).toBe(1);
    expect(validRes.body.data[0].id).toBe("1");
    expect(validRes.body.data[0].recipient).toBe(VALID_RECIPIENT);
  });

  it("retries once and recovers safely when database query timeout is transient on both recipient endpoints", async () => {
    const timeoutErr = Object.assign(new Error("SQLITE_BUSY: database query timeout"), {
      code: "SQLITE_BUSY",
    });

    streamStoreMocks.listStreamsByRecipient
      .mockImplementationOnce(() => {
        throw timeoutErr;
      })
      .mockImplementationOnce((recipientAddress: string) =>
        dbTableDouble.filter((row) => row.recipient === recipientAddress),
      );

    const res1 = await request(app).get(
      `/api/recipients/${VALID_RECIPIENT}/streams`,
    );

    expect(res1.status).toBe(200);
    expect(res1.body.total).toBe(1);
    expect(res1.body.data[0].id).toBe("1");
    expect(res1.body.data[0].recipient).toBe(VALID_RECIPIENT);
    expect(streamStoreMocks.listStreamsByRecipient).toHaveBeenCalledTimes(2);
    expect(streamStoreMocks.createStream).not.toHaveBeenCalled();
    expect(eventHistoryMocks.recordEvent).not.toHaveBeenCalled();
    expect(eventHistoryMocks.recordEventWithDb).not.toHaveBeenCalled();
    expect(rpcDouble.sendTransaction).not.toHaveBeenCalled();

    streamStoreMocks.listStreamsByRecipient.mockClear();
    const pgTimeoutErr = Object.assign(
      new Error("canceling statement due to statement timeout"),
      { code: "57014" },
    );
    streamStoreMocks.listStreamsByRecipient
      .mockImplementationOnce(() => {
        throw pgTimeoutErr;
      })
      .mockImplementationOnce((recipientAddress: string) =>
        dbTableDouble.filter((row) => row.recipient === recipientAddress),
      );

    const res2 = await request(app).get(
      `/api/streams/recipient/${VALID_RECIPIENT}`,
    );
    expect(res2.status).toBe(200);
    expect(res2.body.total).toBe(1);
    expect(res2.body.data[0].id).toBe("1");
    expect(streamStoreMocks.listStreamsByRecipient).toHaveBeenCalledTimes(2);
    expect(cacheSetMock).toHaveBeenCalledTimes(1);
    expect(cacheSetMock).toHaveBeenCalledWith(
      `streams:recipient:${VALID_RECIPIENT}`,
      [sampleStream],
      5,
    );
  });

  it("returns 503 DATABASE_TIMEOUT when database query timeout persists across retry on both recipient endpoints without duplicate side effects", async () => {
    const timeoutErr = Object.assign(
      new Error("Database query timed out while reading streams"),
      { code: "ETIMEDOUT" },
    );
    streamStoreMocks.listStreamsByRecipient.mockImplementation(() => {
      throw timeoutErr;
    });

    const res1 = await request(app).get(
      `/api/recipients/${VALID_RECIPIENT}/streams`,
    );
    expect(res1.status).toBe(503);
    expect(res1.body.code).toBe("DATABASE_TIMEOUT");
    expect(res1.body.error).toContain("Database query timed out");
    expect(streamStoreMocks.listStreamsByRecipient).toHaveBeenCalledTimes(2);

    streamStoreMocks.listStreamsByRecipient.mockClear();

    const res2 = await request(app).get(
      `/api/streams/recipient/${VALID_RECIPIENT}`,
    );
    expect(res2.status).toBe(503);
    expect(res2.body.code).toBe("DATABASE_TIMEOUT");
    expect(streamStoreMocks.listStreamsByRecipient).toHaveBeenCalledTimes(2);
    expect(cacheSetMock).not.toHaveBeenCalled();
    expect(eventHistoryMocks.recordEventWithDb).not.toHaveBeenCalled();
    expect(dbTableDouble).toHaveLength(2);
  });
});
