import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { ADMIN_CALLER } from "./middleware/adminAuth";
import { getJwtSecret } from "./services/auth";

const OLD_ADMIN_KEY = "old-admin-api-key-32-chars-minimum-0001";
const NEW_ADMIN_KEY = "new-admin-api-key-32-chars-minimum-0002";

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
  addAllowedAsset: vi.fn((code: string) => ["USDC", "XLM", code.toUpperCase()]),
  removeAllowedAsset: vi.fn((_code: string) => ["USDC"]),
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
  listStreams: vi.fn(() => []),
  listStreamsByRecipient: vi.fn(() => []),
  listStreamsBySender: vi.fn(() => []),
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
  countAllEvents: vi.fn(() => 0),
  countStreamEvents: vi.fn(() => 0),
  getAllEvents: vi.fn(() => []),
  getGlobalEvents: vi.fn(() => []),
  getStreamEventSummary: vi.fn(),
  getStreamHistory: vi.fn(() => []),
  recordEvent: vi.fn(),
  recordEventWithDb: vi.fn(),
}));

const webhookMocks = vi.hoisted(() => ({
  registerWebhook: vi.fn(),
  listWebhooks: vi.fn(() => []),
  deleteWebhook: vi.fn(),
  triggerWebhooks: vi.fn(),
  getDeadLetters: vi.fn(() => []),
  countDeadLetters: vi.fn(() => 0),
  requeueDeadLetter: vi.fn(),
  clearDeadLetters: vi.fn(() => 3),
  pruneExpiredDeadLetters: vi.fn(() => 0),
}));

vi.mock("./services/cache", () => cacheMocks);
vi.mock("./services/db", () => dbMocks);
vi.mock("./services/indexer", () => indexerMocks);
vi.mock("./services/streamStore", () => streamStoreMocks);
vi.mock("./services/eventHistory", () => eventHistoryMocks);
vi.mock("./services/webhook", () => webhookMocks);

import { app } from "./index";

describe("Admin API authorization workflow (SSB-2026-170)", () => {
  const originalAdminKey = process.env.ADMIN_API_KEY;

  beforeEach(() => {
    vi.clearAllMocks();
    process.env.ADMIN_API_KEY = OLD_ADMIN_KEY;
    streamStoreMocks.deleteStreamById.mockReturnValue(true);
    webhookMocks.clearDeadLetters.mockReturnValue(3);
  });

  afterEach(() => {
    if (originalAdminKey === undefined) delete process.env.ADMIN_API_KEY;
    else process.env.ADMIN_API_KEY = originalAdminKey;
  });

  describe("Missing API keys", () => {
    it("rejects missing API keys across admin endpoints with 401 ADMIN_KEY_MISSING and zero side effects", async () => {
      const deleteStreamRes = await request(app)
        .delete("/api/streams/101")
        .set("X-Correlation-Id", "corr-missing-stream");

      expect(deleteStreamRes.status).toBe(401);
      expect(deleteStreamRes.body).toEqual(
        expect.objectContaining({
          statusCode: 401,
          code: "ADMIN_KEY_MISSING",
          correlationId: "corr-missing-stream",
          error: expect.any(String),
          requestId: expect.any(String),
        }),
      );

      const clearDeadLettersRes = await request(app)
        .delete("/api/admin/webhooks/dead-letters")
        .set("X-Correlation-Id", "corr-missing-dlq");

      expect(clearDeadLettersRes.status).toBe(401);
      expect(clearDeadLettersRes.body).toEqual(
        expect.objectContaining({
          statusCode: 401,
          code: "ADMIN_KEY_MISSING",
          correlationId: "corr-missing-dlq",
        }),
      );

      const authExchangeRes = await request(app)
        .post("/api/admin/auth")
        .set("X-Correlation-Id", "corr-missing-auth")
        .send({});

      expect(authExchangeRes.status).toBe(401);
      expect(authExchangeRes.body).toEqual(
        expect.objectContaining({
          statusCode: 401,
          code: "ADMIN_KEY_MISSING",
          correlationId: "corr-missing-auth",
        }),
      );
      expect(authExchangeRes.body.token).toBeUndefined();

      const aliasExchangeRes = await request(app)
        .post("/api/auth/admin")
        .send({});

      expect(aliasExchangeRes.status).toBe(401);
      expect(aliasExchangeRes.body).toEqual(
        expect.objectContaining({
          statusCode: 401,
          code: "ADMIN_KEY_MISSING",
        }),
      );

      expect(streamStoreMocks.deleteStreamById).not.toHaveBeenCalled();
      expect(webhookMocks.clearDeadLetters).not.toHaveBeenCalled();
      expect(dbMocks.addAllowedAsset).not.toHaveBeenCalled();
      expect(eventHistoryMocks.recordEvent).not.toHaveBeenCalled();
      expect(rpcDouble.sendTransaction).not.toHaveBeenCalled();
    });

    it("rejects requests with 401 ADMIN_KEY_NOT_CONFIGURED when ADMIN_API_KEY is unset or blank", async () => {
      for (const unconfigured of [undefined, "", "   "]) {
        if (unconfigured === undefined) delete process.env.ADMIN_API_KEY;
        else process.env.ADMIN_API_KEY = unconfigured;

        const streamRes = await request(app)
          .delete("/api/streams/101")
          .set("X-Admin-Key", OLD_ADMIN_KEY);

        expect(streamRes.status).toBe(401);
        expect(streamRes.body).toEqual(
          expect.objectContaining({
            statusCode: 401,
            code: "ADMIN_KEY_NOT_CONFIGURED",
          }),
        );

        const tokenRes = await request(app)
          .post("/api/admin/auth")
          .send({ apiKey: OLD_ADMIN_KEY });

        expect(tokenRes.status).toBe(401);
        expect(tokenRes.body).toEqual(
          expect.objectContaining({
            statusCode: 401,
            code: "ADMIN_KEY_NOT_CONFIGURED",
          }),
        );
      }

      expect(streamStoreMocks.deleteStreamById).not.toHaveBeenCalled();
      expect(webhookMocks.clearDeadLetters).not.toHaveBeenCalled();
    });
  });

  describe("Malformed API keys", () => {
    it("rejects empty, whitespace-only, duplicate, internal-whitespace, non-string, and conflicting keys with 401 ADMIN_KEY_MALFORMED", async () => {
      // 1. Empty and whitespace-only X-Admin-Key headers on adminAuth routes
      for (const badHeader of ["", "   ", "Bearer " + OLD_ADMIN_KEY, `${OLD_ADMIN_KEY},extra`]) {
        const res = await request(app)
          .delete("/api/streams/101")
          .set("X-Admin-Key", badHeader);

        expect(res.status).toBe(401);
        expect(res.body).toEqual(
          expect.objectContaining({
            statusCode: 401,
            code: "ADMIN_KEY_MALFORMED",
          }),
        );
      }

      // 2. Duplicate X-Admin-Key headers over HTTP (folded or multi-header)
      const duplicateHeaderStreamRes = await request(app)
        .delete("/api/streams/101")
        .set("X-Admin-Key", [OLD_ADMIN_KEY, NEW_ADMIN_KEY]);

      expect(duplicateHeaderStreamRes.status).toBe(401);
      expect(duplicateHeaderStreamRes.body).toEqual(
        expect.objectContaining({
          statusCode: 401,
          code: "ADMIN_KEY_MALFORMED",
        }),
      );

      const duplicateHeaderAuthRes = await request(app)
        .post("/api/admin/auth")
        .set("X-Admin-Key", [OLD_ADMIN_KEY, OLD_ADMIN_KEY])
        .send({});

      expect(duplicateHeaderAuthRes.status).toBe(401);
      expect(duplicateHeaderAuthRes.body).toEqual(
        expect.objectContaining({
          statusCode: 401,
          code: "ADMIN_KEY_MALFORMED",
        }),
      );

      // 3. Malformed body.apiKey payloads on POST /api/admin/auth
      for (const malformedBody of [
        { apiKey: "" },
        { apiKey: "   " },
        { apiKey: 12345 },
        { apiKey: null },
        { apiKey: [OLD_ADMIN_KEY] },
        { apiKey: { nested: OLD_ADMIN_KEY } },
        { apiKey: `Bearer ${OLD_ADMIN_KEY}` },
        { apiKey: `${OLD_ADMIN_KEY},second` },
      ]) {
        const res = await request(app)
          .post("/api/admin/auth")
          .send(malformedBody);

        expect(res.status).toBe(401);
        expect(res.body).toEqual(
          expect.objectContaining({
            statusCode: 401,
            code: "ADMIN_KEY_MALFORMED",
          }),
        );
        expect(res.body.token).toBeUndefined();
      }

      // 4. Conflicting X-Admin-Key header and body.apiKey on POST /api/admin/auth
      const conflictingRes = await request(app)
        .post("/api/admin/auth")
        .set("X-Admin-Key", OLD_ADMIN_KEY)
        .send({ apiKey: NEW_ADMIN_KEY });

      expect(conflictingRes.status).toBe(401);
      expect(conflictingRes.body).toEqual(
        expect.objectContaining({
          statusCode: 401,
          code: "ADMIN_KEY_MALFORMED",
        }),
      );

      expect(streamStoreMocks.deleteStreamById).not.toHaveBeenCalled();
      expect(webhookMocks.clearDeadLetters).not.toHaveBeenCalled();
    });
  });

  describe("Rotated API keys", () => {
    it("accepts the active key before rotation, rejects the rotated-out key with 401 ADMIN_KEY_INVALID after rotation, and accepts the new key without duplicate side effects", async () => {
      // Pre-rotation: OLD_ADMIN_KEY succeeds on token exchange and adminAuth routes
      const preAuthRes = await request(app)
        .post("/api/admin/auth")
        .send({ apiKey: OLD_ADMIN_KEY });

      expect(preAuthRes.status).toBe(200);
      expect(typeof preAuthRes.body.token).toBe("string");
      const decodedPre = jwt.verify(preAuthRes.body.token, getJwtSecret()) as Record<string, unknown>;
      expect(decodedPre).toEqual(expect.objectContaining(ADMIN_CALLER));

      const preDeleteRes = await request(app)
        .delete("/api/streams/101")
        .set("X-Admin-Key", OLD_ADMIN_KEY);
      expect(preDeleteRes.status).toBe(204);
      expect(streamStoreMocks.deleteStreamById).toHaveBeenCalledTimes(1);
      expect(streamStoreMocks.deleteStreamById).toHaveBeenLastCalledWith("101");

      // Pre-rotation: NEW_ADMIN_KEY is not yet active -> 401 ADMIN_KEY_INVALID
      const preNewKeyRes = await request(app)
        .delete("/api/streams/102")
        .set("X-Admin-Key", NEW_ADMIN_KEY);
      expect(preNewKeyRes.status).toBe(401);
      expect(preNewKeyRes.body).toEqual(
        expect.objectContaining({
          statusCode: 401,
          code: "ADMIN_KEY_INVALID",
        }),
      );
      expect(streamStoreMocks.deleteStreamById).toHaveBeenCalledTimes(1);

      // Rotate ADMIN_API_KEY
      process.env.ADMIN_API_KEY = NEW_ADMIN_KEY;

      // Post-rotation: OLD_ADMIN_KEY is rejected everywhere with 401 ADMIN_KEY_INVALID
      const postOldAuthRes = await request(app)
        .post("/api/admin/auth")
        .send({ apiKey: OLD_ADMIN_KEY });
      expect(postOldAuthRes.status).toBe(401);
      expect(postOldAuthRes.body).toEqual(
        expect.objectContaining({
          statusCode: 401,
          code: "ADMIN_KEY_INVALID",
        }),
      );

      const postOldStreamRes = await request(app)
        .delete("/api/streams/102")
        .set("X-Admin-Key", OLD_ADMIN_KEY);
      expect(postOldStreamRes.status).toBe(401);
      expect(postOldStreamRes.body).toEqual(
        expect.objectContaining({
          statusCode: 401,
          code: "ADMIN_KEY_INVALID",
        }),
      );

      const postOldDlqRes = await request(app)
        .delete("/api/admin/webhooks/dead-letters")
        .set("X-Admin-Key", OLD_ADMIN_KEY);
      expect(postOldDlqRes.status).toBe(401);
      expect(postOldDlqRes.body).toEqual(
        expect.objectContaining({
          statusCode: 401,
          code: "ADMIN_KEY_INVALID",
        }),
      );

      // Verify denied requests caused no additional side effects
      expect(streamStoreMocks.deleteStreamById).toHaveBeenCalledTimes(1);
      expect(webhookMocks.clearDeadLetters).not.toHaveBeenCalled();

      // Post-rotation: NEW_ADMIN_KEY is accepted across token exchange and adminAuth routes
      const postNewAuthRes = await request(app)
        .post("/api/admin/auth")
        .set("X-Admin-Key", NEW_ADMIN_KEY)
        .send({});
      expect(postNewAuthRes.status).toBe(200);
      const decodedPost = jwt.verify(postNewAuthRes.body.token, getJwtSecret()) as Record<string, unknown>;
      expect(decodedPost).toEqual(expect.objectContaining(ADMIN_CALLER));

      const postNewDlqRes = await request(app)
        .delete("/api/admin/webhooks/dead-letters")
        .set("X-Admin-Key", NEW_ADMIN_KEY);
      expect(postNewDlqRes.status).toBe(200);
      expect(postNewDlqRes.body).toEqual({
        success: true,
        deleted: 3,
        message: "Webhook dead-letter queue cleared successfully",
      });
      expect(webhookMocks.clearDeadLetters).toHaveBeenCalledTimes(1);
    });
  });

  describe("Concurrent key rotation and request execution", () => {
    it("isolates in-flight pre-rotation requests from concurrent key rotation and post-rotation requests without duplicate side effects", async () => {
      const authorizedCallers: Array<{
        streamId: string;
        caller: unknown;
        keySnapshotAtEntry: string | undefined;
      }> = [];
      const deniedRequests: Array<{
        path: string;
        code: string;
        statusCode: number;
        userOnReq: unknown;
      }> = [];

      // Instrument an isolated admin route on the Express app to observe async in-flight
      // execution across a deterministic rotation barrier while also testing the production
      // DELETE /api/streams/:id and DELETE /api/admin/webhooks/dead-letters routes.
      let releaseInFlight!: () => void;
      const inFlightBarrier = new Promise<void>((resolve) => {
        releaseInFlight = resolve;
      });
      let notifyEnteredHandler!: () => void;
      const enteredHandler = new Promise<void>((resolve) => {
        notifyEnteredHandler = resolve;
      });

      streamStoreMocks.deleteStreamById.mockImplementation((streamId: string) => {
        authorizedCallers.push({
          streamId,
          caller: { ...ADMIN_CALLER },
          keySnapshotAtEntry: process.env.ADMIN_API_KEY,
        });
        return true;
      });

      app.post(
        "/api/admin/__test-concurrent-rotation/:streamId",
        (req, res, next) => {
          res.on("finish", () => {
            if (res.statusCode >= 400) {
              deniedRequests.push({
                path: req.path,
                code: (res.locals as { errorCode?: string })?.errorCode ?? "DENIED",
                statusCode: res.statusCode,
                userOnReq: (req as { user?: unknown }).user,
              });
            }
          });
          next();
        },
        async (req, res, next) => {
          const { adminAuth: prodAdminAuth } = await import("./middleware/adminAuth");
          prodAdminAuth(req, res, next);
        },
        async (req, res) => {
          const streamId = String(req.params.streamId);
          const caller = (req as { user?: unknown }).user;
          const keyAtEntry = process.env.ADMIN_API_KEY;

          if (streamId === "201") {
            notifyEnteredHandler();
            await inFlightBarrier;
          }

          streamStoreMocks.deleteStreamById(streamId);
          authorizedCallers.splice(authorizedCallers.length - 1, 1, {
            streamId,
            caller,
            keySnapshotAtEntry: keyAtEntry,
          });

          res.status(200).json({
            deletedStreamId: streamId,
            authorizedCaller: caller,
          });
        },
      );

      // 1. Start in-flight request 201 under OLD_ADMIN_KEY and wait until it passes adminAuth
      const inFlightPromise = request(app)
        .post("/api/admin/__test-concurrent-rotation/201")
        .set("X-Admin-Key", OLD_ADMIN_KEY)
        .then((res) => res);

      await enteredHandler;

      // 2. Rotate ADMIN_API_KEY while request 201 is still in-flight
      process.env.ADMIN_API_KEY = NEW_ADMIN_KEY;

      // 3. Fire concurrent requests while request 201 is suspended at the barrier:
      //    - stale OLD_ADMIN_KEY request (must be denied with 401 ADMIN_KEY_INVALID)
      //    - malformed key request (must be denied with 401 ADMIN_KEY_MALFORMED)
      //    - missing key request (must be denied with 401 ADMIN_KEY_MISSING)
      //    - fresh NEW_ADMIN_KEY request 202 (must succeed once)
      //    - fresh NEW_ADMIN_KEY production DELETE /api/streams/203 (must succeed once)
      const [
        staleKeyRes,
        malformedKeyRes,
        missingKeyRes,
        freshConcurrentRes,
        freshProdDeleteRes,
      ] = await Promise.all([
        request(app)
          .post("/api/admin/__test-concurrent-rotation/202-stale")
          .set("X-Admin-Key", OLD_ADMIN_KEY),
        request(app)
          .post("/api/admin/__test-concurrent-rotation/202-malformed")
          .set("X-Admin-Key", "   "),
        request(app)
          .post("/api/admin/__test-concurrent-rotation/202-missing"),
        request(app)
          .post("/api/admin/__test-concurrent-rotation/202")
          .set("X-Admin-Key", NEW_ADMIN_KEY),
        request(app)
          .delete("/api/streams/203")
          .set("X-Admin-Key", NEW_ADMIN_KEY),
      ]);

      // Release the pre-rotation in-flight request
      releaseInFlight();
      const inFlightRes = await inFlightPromise;

      // Assert statuses and responses
      expect(inFlightRes.status).toBe(200);
      expect(inFlightRes.body).toEqual({
        deletedStreamId: "201",
        authorizedCaller: ADMIN_CALLER,
      });

      expect(staleKeyRes.status).toBe(401);
      expect(staleKeyRes.body).toEqual(
        expect.objectContaining({
          statusCode: 401,
          code: "ADMIN_KEY_INVALID",
        }),
      );

      expect(malformedKeyRes.status).toBe(401);
      expect(malformedKeyRes.body).toEqual(
        expect.objectContaining({
          statusCode: 401,
          code: "ADMIN_KEY_MALFORMED",
        }),
      );

      expect(missingKeyRes.status).toBe(401);
      expect(missingKeyRes.body).toEqual(
        expect.objectContaining({
          statusCode: 401,
          code: "ADMIN_KEY_MISSING",
        }),
      );

      expect(freshConcurrentRes.status).toBe(200);
      expect(freshConcurrentRes.body).toEqual({
        deletedStreamId: "202",
        authorizedCaller: ADMIN_CALLER,
      });

      expect(freshProdDeleteRes.status).toBe(204);

      // Assert stored authorized callers and denied requests
      expect(authorizedCallers).toEqual([
        {
          streamId: "202",
          caller: ADMIN_CALLER,
          keySnapshotAtEntry: NEW_ADMIN_KEY,
        },
        {
          streamId: "203",
          caller: ADMIN_CALLER,
          keySnapshotAtEntry: NEW_ADMIN_KEY,
        },
        {
          streamId: "201",
          caller: ADMIN_CALLER,
          keySnapshotAtEntry: OLD_ADMIN_KEY,
        },
      ]);

      expect(deniedRequests).toHaveLength(3);
      for (const denied of deniedRequests) {
        expect(denied.statusCode).toBe(401);
        expect(denied.userOnReq).toBeUndefined();
      }

      // Assert absence of duplicate side effects: only streams 201, 202, and 203 were deleted once each
      expect(streamStoreMocks.deleteStreamById).toHaveBeenCalledTimes(3);
      expect(streamStoreMocks.deleteStreamById.mock.calls.map((c) => c[0])).toEqual([
        "202",
        "203",
        "201",
      ]);
      expect(eventHistoryMocks.recordEvent).not.toHaveBeenCalled();
      expect(rpcDouble.sendTransaction).not.toHaveBeenCalled();
    });
  });
});
