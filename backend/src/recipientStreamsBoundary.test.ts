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
  totalAmount: 250,
  durationSeconds: 200,
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

describe("Recipient streams endpoint boundary behavior (SSB-2026-111 / SSB-2026-115)", () => {
  let storedStreams: Array<typeof sampleStream>;

  beforeEach(() => {
    vi.clearAllMocks();
    cacheGetMock.mockResolvedValue(null);
    cacheSetMock.mockResolvedValue(undefined);
    streamStoreMocks.calculateProgress.mockReturnValue(sampleProgress);

    storedStreams = [{ ...sampleStream }, { ...otherRecipientStream }];
    streamStoreMocks.listStreamsByRecipient.mockImplementation(
      (recipientAddress: string) =>
        storedStreams.filter((stream) => stream.recipient === recipientAddress),
    );
  });

  describe("Account ID checksum & format boundaries", () => {
    it("rejects corrupted checksum with 400 VALIDATION_ERROR on GET /api/recipients/:accountId/streams", async () => {
      const res = await request(app).get(
        `/api/recipients/${INVALID_CHECKSUM_RECIPIENT}/streams`,
      );
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("VALIDATION_ERROR");
      expect(res.body.error).toContain("must be a valid Stellar account ID");
      expect(res.body.details?.[0].field).toBe("accountId");
      expect(streamStoreMocks.listStreamsByRecipient).not.toHaveBeenCalled();
      expect(cacheGetMock).not.toHaveBeenCalled();
      expect(cacheSetMock).not.toHaveBeenCalled();
      expect(rpcDouble.simulateTransaction).not.toHaveBeenCalled();
    });

    it("rejects corrupted checksum with 400 VALIDATION_ERROR on GET /api/streams/recipient/:address", async () => {
      const res = await request(app).get(
        `/api/streams/recipient/${INVALID_CHECKSUM_RECIPIENT}`,
      );
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("VALIDATION_ERROR");
      expect(res.body.error).toContain("must be a valid Stellar account ID");
      expect(streamStoreMocks.listStreamsByRecipient).not.toHaveBeenCalled();
      expect(cacheGetMock).not.toHaveBeenCalled();
      expect(cacheSetMock).not.toHaveBeenCalled();
      expect(rpcDouble.simulateTransaction).not.toHaveBeenCalled();
    });

    it("rejects account IDs that do not start with G", async () => {
      const invalidPrefix = "S" + VALID_RECIPIENT.slice(1);
      const res = await request(app).get(
        `/api/recipients/${invalidPrefix}/streams`,
      );
      expect(res.status).toBe(400);
      expect(res.body.code).toBe("VALIDATION_ERROR");
      expect(streamStoreMocks.listStreamsByRecipient).not.toHaveBeenCalled();
    });

    it("rejects account IDs with invalid character length (55 and 57 chars)", async () => {
      const tooShort = VALID_RECIPIENT.slice(0, 55);
      const tooLong = VALID_RECIPIENT + "A";

      const resShort = await request(app).get(`/api/recipients/${tooShort}/streams`);
      expect(resShort.status).toBe(400);

      const resLong = await request(app).get(`/api/recipients/${tooLong}/streams`);
      expect(resLong.status).toBe(400);
    });
  });

  describe("Valid empty account versus populated recipient results", () => {
    it("returns 200 OK with an empty array for a valid empty account while preserving stored recipient-specific streams", async () => {
      const res1 = await request(app).get(
        `/api/recipients/${EMPTY_VALID_RECIPIENT}/streams`,
      );
      expect(res1.status).toBe(200);
      expect(res1.body).toEqual({
        data: [],
        total: 0,
        page: 1,
        limit: 0,
      });

      const res2 = await request(app).get(
        `/api/streams/recipient/${EMPTY_VALID_RECIPIENT}`,
      );
      expect(res2.status).toBe(200);
      expect(res2.body).toEqual({
        data: [],
        total: 0,
        page: 1,
        limit: 0,
      });

      // Stored recipient-specific streams for populated recipients remain intact and isolated
      const populatedRes = await request(app).get(
        `/api/recipients/${VALID_RECIPIENT}/streams`,
      );
      expect(populatedRes.status).toBe(200);
      expect(populatedRes.body.total).toBe(1);
      expect(populatedRes.body.data).toHaveLength(1);
      expect(populatedRes.body.data[0].id).toBe("1");
      expect(populatedRes.body.data[0].recipient).toBe(VALID_RECIPIENT);
      expect(eventHistoryMocks.recordEvent).not.toHaveBeenCalled();
      expect(eventHistoryMocks.recordEventWithDb).not.toHaveBeenCalled();
    });

    it("returns populated streams for a valid recipient and computes live progress", async () => {
      const res = await request(app).get(
        `/api/recipients/${VALID_RECIPIENT}/streams`,
      );
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(1);
      expect(res.body.data[0].id).toBe("1");
      expect(res.body.data[0].recipient).toBe(VALID_RECIPIENT);
      expect(res.body.data[0].progress.status).toBe("active");
    });
  });

  describe("Boundary query inputs & result isolation", () => {
    it("applies query.recipient filtering without silently leaking or altering scoped results", async () => {
      // Querying matching recipient in query returns the stream
      const matchingRes = await request(app)
        .get(`/api/recipients/${VALID_RECIPIENT}/streams`)
        .query({ recipient: VALID_RECIPIENT });
      expect(matchingRes.status).toBe(200);
      expect(matchingRes.body.data).toHaveLength(1);

      // Querying conflicting recipient returns 0 results, preserving isolation
      const conflictingRes = await request(app)
        .get(`/api/recipients/${VALID_RECIPIENT}/streams`)
        .query({ recipient: OTHER_RECIPIENT });
      expect(conflictingRes.status).toBe(200);
      expect(conflictingRes.body.data).toHaveLength(0);
      expect(conflictingRes.body.total).toBe(0);
    });

    it("applies query.recipient on /api/streams/recipient/:address as well", async () => {
      const conflictingRes = await request(app)
        .get(`/api/streams/recipient/${VALID_RECIPIENT}`)
        .query({ recipient: OTHER_RECIPIENT });
      expect(conflictingRes.status).toBe(200);
      expect(conflictingRes.body.data).toHaveLength(0);
      expect(conflictingRes.body.total).toBe(0);
    });
  });

  describe("Database query timeout handling & recovery", () => {
    it("recovers safely upon transient database lock/timeout retry without duplicate side effects", async () => {
      const busyErr = Object.assign(new Error("SQLITE_BUSY: database is locked"), {
        code: "SQLITE_BUSY",
      });
      streamStoreMocks.listStreamsByRecipient
        .mockImplementationOnce(() => {
          throw busyErr;
        })
        .mockImplementationOnce((recipientAddress: string) =>
          storedStreams.filter((stream) => stream.recipient === recipientAddress),
        );

      const res = await request(app).get(
        `/api/recipients/${VALID_RECIPIENT}/streams`,
      );
      expect(res.status).toBe(200);
      expect(res.body.total).toBe(1);
      expect(res.body.data[0].recipient).toBe(VALID_RECIPIENT);
      expect(streamStoreMocks.listStreamsByRecipient).toHaveBeenCalledTimes(2);
      expect(eventHistoryMocks.recordEvent).not.toHaveBeenCalled();
      expect(eventHistoryMocks.recordEventWithDb).not.toHaveBeenCalled();
      expect(rpcDouble.sendTransaction).not.toHaveBeenCalled();
    });

    it("returns deterministic 503 DATABASE_TIMEOUT when database query timeout persists without caching failed responses", async () => {
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
      expect(res2.body.error).toContain("Database query timed out");
      // Exactly 1 initial attempt + 1 retry (withAddressCache does not re-invoke fetcher on DB error)
      expect(streamStoreMocks.listStreamsByRecipient).toHaveBeenCalledTimes(2);
      expect(cacheSetMock).not.toHaveBeenCalled();
      expect(eventHistoryMocks.recordEvent).not.toHaveBeenCalled();
      expect(eventHistoryMocks.recordEventWithDb).not.toHaveBeenCalled();
    });
  });
});
