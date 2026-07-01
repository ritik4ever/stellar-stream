/**
 * Integration tests for all auth-protected routes (#375)
 *
 * Verifies that every route guarded by authMiddleware or adminAuth correctly:
 *   - Rejects requests with no token         → 401
 *   - Rejects requests with an expired token  → 401
 *   - Allows requests with a valid token     → passes auth (2xx or a non-401
 *                                              domain-level error)
 *
 * Admin routes (adminAuth / X-Admin-Key):
 *   - Rejects requests with no key           → 401
 *   - Rejects requests with a wrong key      → 401
 *   - Allows requests with a valid key       → 2xx (or non-401 domain error)
 *
 * NOTE: adminAuth returns 401 (not 403) for missing/wrong keys. The issue
 * acceptance criteria says "no key → 403" but the actual implementation in
 * src/middleware/adminAuth.ts returns 401. Tests assert the real behaviour.
 * Update expectations below if the middleware is ever changed to return 403.
 *
 * Environment / rate-limit note
 * ──────────────────────────────
 * Several routes place mutationLimiter BEFORE authMiddleware in their
 * middleware chain (mark-complete, pause, resume, claim). Without a high
 * rate-limit ceiling the limiter exhausts its 10 req/min budget during the
 * test run and returns 429 instead of the expected 401.
 *
 * This is addressed by src/test-setup.ts (loaded via vitest setupFiles),
 * which sets MUTATION_RATE_LIMIT=999999 before any module is imported.
 * The pool:"forks" setting in vitest.config.ts gives each test file its own
 * fresh Node process, so the rate limiter is re-initialised with those values.
 */

import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import path from "path";
import fs from "fs";

// Use a dedicated DB so this file never collides with other test files
const TEST_DB_PATH = path.join(
  __dirname,
  "..",
  "data",
  "test-auth-protected-375.db",
);
process.env.DB_PATH = TEST_DB_PATH;

// Import app AFTER DB_PATH is set (env vars that control rate limits are
// already set by src/test-setup.ts which runs before any imports).
import { app } from "./index";
import { initDb, getDb } from "./services/db";
import { initCache, getCache } from "./services/cache";
import { getJwtSecret } from "./services/auth";
import { Keypair } from "@stellar/stellar-sdk";

// ── Token helpers ─────────────────────────────────────────────────────────────

/** Generates a valid JWT signed with the test secret. */
function makeValidToken(accountId?: string): string {
  const id = accountId ?? Keypair.random().publicKey();
  return jwt.sign({ accountId: id }, getJwtSecret(), { expiresIn: "1h" });
}

/** Generates an already-expired JWT. */
function makeExpiredToken(accountId?: string): string {
  const id = accountId ?? Keypair.random().publicKey();
  return jwt.sign({ accountId: id }, getJwtSecret(), { expiresIn: "-1h" });
}

// ── Stream fixture ────────────────────────────────────────────────────────────

const FIXTURE_STREAM_ID = "375001";

function cleanFixtureStream() {
  const db = getDb();
  // Delete child-table rows first to satisfy FK constraints.
  db.exec(`DELETE FROM webhook_dead_letters WHERE stream_id = '${FIXTURE_STREAM_ID}'`);
  db.exec(`DELETE FROM webhook_deliveries   WHERE stream_id = '${FIXTURE_STREAM_ID}'`);
  db.exec(`DELETE FROM stream_events        WHERE stream_id = '${FIXTURE_STREAM_ID}'`);
  db.exec(`DELETE FROM streams              WHERE id        = '${FIXTURE_STREAM_ID}'`);
}

function seedFixtureStream(senderPub: string, recipientPub: string) {
  cleanFixtureStream();
  const now = Math.floor(Date.now() / 1000);
  getDb()
    .prepare(
      `INSERT INTO streams
         (id, sender, recipient, asset_code, total_amount, duration_seconds, start_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(FIXTURE_STREAM_ID, senderPub, recipientPub, "USDC", 1000, 3600, now - 60, now - 60);
}

// ── Dead-letter fixture ───────────────────────────────────────────────────────

const FIXTURE_DL_ID = 375001;

function seedDeadLetterFixture() {
  const db = getDb();
  db.exec(`DELETE FROM webhook_dead_letters WHERE id = ${FIXTURE_DL_ID}`);

  // Ensure the parent stream row exists
  const existing = db.prepare(`SELECT id FROM streams WHERE id = ?`).get(FIXTURE_STREAM_ID);
  if (!existing) {
    const now = Math.floor(Date.now() / 1000);
    db.prepare(
      `INSERT INTO streams
         (id, sender, recipient, asset_code, total_amount, duration_seconds, start_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      FIXTURE_STREAM_ID,
      Keypair.random().publicKey(),
      Keypair.random().publicKey(),
      "USDC", 100, 3600, Math.floor(Date.now() / 1000), Math.floor(Date.now() / 1000),
    );
  }

  // Schema: id, stream_id, event, url, payload, last_error, failed_at
  getDb()
    .prepare(
      `INSERT INTO webhook_dead_letters (id, stream_id, event, url, payload, last_error, failed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      FIXTURE_DL_ID,
      FIXTURE_STREAM_ID,
      "created",
      "https://example.com/hook",
      JSON.stringify({ streamId: FIXTURE_STREAM_ID }),
      "connection refused",
      Math.floor(Date.now() / 1000),
    );
}

// ── Request helper ────────────────────────────────────────────────────────────

type Method = "get" | "post" | "patch" | "delete";

async function send(
  method: Method,
  url: string,
  opts: { token?: string; adminKey?: string; body?: Record<string, unknown> } = {},
) {
  let req = (request(app) as any)[method](url);
  if (opts.token)    req = req.set("Authorization", `Bearer ${opts.token}`);
  if (opts.adminKey) req = req.set("X-Admin-Key", opts.adminKey);
  if (opts.body)     req = req.send(opts.body);
  return req;
}

// ── Assertion helpers ─────────────────────────────────────────────────────────

/** Assert that the auth layer rejected the request with 401. */
function expect401(res: request.Response) {
  expect(
    res.status,
    `Expected 401 but got ${res.status}: ${JSON.stringify(res.body)}`,
  ).toBe(401);
}

/**
 * Assert that the auth layer passed – the route may still return a 4xx/5xx
 * for domain reasons (missing resource, validation error, etc.), but it must
 * NOT be 401.
 */
function expectAuthPassed(res: request.Response) {
  expect(
    res.status,
    `Expected auth to pass (non-401) but got ${res.status}: ${JSON.stringify(res.body)}`,
  ).not.toBe(401);
}

// ════════════════════════════════════════════════════════════════════════════
//  Test suite
// ════════════════════════════════════════════════════════════════════════════

describe("Auth-protected routes integration tests (#375)", () => {
  const senderKp    = Keypair.random();
  const recipientKp = Keypair.random();

  const senderToken    = () => makeValidToken(senderKp.publicKey());
  const expiredToken   = () => makeExpiredToken(senderKp.publicKey());
  const strangerToken  = () => makeValidToken(); // unrelated account

  const ADMIN_KEY = process.env.ADMIN_API_KEY as string;

  beforeAll(() => {
    initDb();
    initCache();
    seedFixtureStream(senderKp.publicKey(), recipientKp.publicKey());
  });

  beforeEach(async () => {
    await getCache().clear();
  });

  afterAll(() => {
    try { getDb().close(); } catch { /* already closed */ }
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  });

  // ══════════════════════════════════════════════════════════════════════════
  //  1. POST /api/streams/fee-estimate
  // ══════════════════════════════════════════════════════════════════════════

  describe("POST /api/streams/fee-estimate", () => {
    const url  = "/api/streams/fee-estimate";
    const body = {
      sender: Keypair.random().publicKey(), recipient: Keypair.random().publicKey(),
      assetCode: "USDC", totalAmount: 100, durationSeconds: 3600,
    };

    it("no token → 401", async () => expect401(await send("post", url, { body })));

    it("expired token → 401", async () => {
      const res = await send("post", url, { token: expiredToken(), body });
      expect401(res);
      expect(res.body.code).toBe("token_expired");
    });

    it("valid token → auth passes (non-401)", async () => {
      expectAuthPassed(await send("post", url, { token: senderToken(), body }));
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  //  2. POST /api/streams
  // ══════════════════════════════════════════════════════════════════════════

  describe("POST /api/streams", () => {
    const url  = "/api/streams";
    const body = {
      sender: Keypair.random().publicKey(), recipient: Keypair.random().publicKey(),
      assetCode: "USDC", totalAmount: 100, durationSeconds: 3600,
    };

    it("no token → 401", async () => expect401(await send("post", url, { body })));

    it("expired token → 401", async () => {
      const res = await send("post", url, { token: expiredToken(), body });
      expect401(res);
      expect(res.body.code).toBe("token_expired");
    });

    it("valid token → auth passes (non-401)", async () => {
      expectAuthPassed(await send("post", url, { token: senderToken(), body }));
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  //  3. POST /api/streams/:id/cancel
  // ══════════════════════════════════════════════════════════════════════════

  describe("POST /api/streams/:id/cancel", () => {
    const url = `/api/streams/${FIXTURE_STREAM_ID}/cancel`;

    it("no token → 401", async () => expect401(await send("post", url)));

    it("expired token → 401", async () => {
      const res = await send("post", url, { token: expiredToken() });
      expect401(res);
      expect(res.body.code).toBe("token_expired");
    });

    it("valid token (sender) → 200", async () => {
      seedFixtureStream(senderKp.publicKey(), recipientKp.publicKey());
      const res = await send("post", url, { token: senderToken() });
      expectAuthPassed(res);
      expect(res.status).toBe(200);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  //  4. POST /api/streams/:id/mark-complete
  // ══════════════════════════════════════════════════════════════════════════

  describe("POST /api/streams/:id/mark-complete", () => {
    const url = `/api/streams/${FIXTURE_STREAM_ID}/mark-complete`;

    it("no token → 401", async () => expect401(await send("post", url)));

    it("expired token → 401", async () => {
      const res = await send("post", url, { token: expiredToken() });
      expect401(res);
      expect(res.body.code).toBe("token_expired");
    });

    it("valid token → auth passes (non-401)", async () => {
      seedFixtureStream(senderKp.publicKey(), recipientKp.publicKey());
      expectAuthPassed(await send("post", url, { token: senderToken() }));
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  //  5. POST /api/streams/:id/pause
  // ══════════════════════════════════════════════════════════════════════════

  describe("POST /api/streams/:id/pause", () => {
    const url = `/api/streams/${FIXTURE_STREAM_ID}/pause`;

    it("no token → 401", async () => expect401(await send("post", url)));

    it("expired token → 401", async () => {
      const res = await send("post", url, { token: expiredToken() });
      expect401(res);
      expect(res.body.code).toBe("token_expired");
    });

    it("valid token → auth passes (non-401)", async () => {
      seedFixtureStream(senderKp.publicKey(), recipientKp.publicKey());
      expectAuthPassed(await send("post", url, { token: senderToken() }));
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  //  6. POST /api/streams/:id/resume
  // ══════════════════════════════════════════════════════════════════════════

  describe("POST /api/streams/:id/resume", () => {
    const url = `/api/streams/${FIXTURE_STREAM_ID}/resume`;

    it("no token → 401", async () => expect401(await send("post", url)));

    it("expired token → 401", async () => {
      const res = await send("post", url, { token: expiredToken() });
      expect401(res);
      expect(res.body.code).toBe("token_expired");
    });

    it("valid token → auth passes (non-401)", async () => {
      seedFixtureStream(senderKp.publicKey(), recipientKp.publicKey());
      expectAuthPassed(await send("post", url, { token: senderToken() }));
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  //  7. POST /api/streams/:id/reconcile
  // ══════════════════════════════════════════════════════════════════════════

  describe("POST /api/streams/:id/reconcile", () => {
    const url = `/api/streams/${FIXTURE_STREAM_ID}/reconcile`;

    it("no token → 401", async () => expect401(await send("post", url)));

    it("expired token → 401", async () => {
      const res = await send("post", url, { token: expiredToken() });
      expect401(res);
      expect(res.body.code).toBe("token_expired");
    });

    it("valid token → auth passes (non-401)", async () => {
      seedFixtureStream(senderKp.publicKey(), recipientKp.publicKey());
      // reconcile has no ownership guard; any valid token passes auth
      expectAuthPassed(await send("post", url, { token: strangerToken() }));
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  //  8. POST /api/streams/:id/claim
  // ══════════════════════════════════════════════════════════════════════════

  describe("POST /api/streams/:id/claim", () => {
    const url = `/api/streams/${FIXTURE_STREAM_ID}/claim`;

    it("no token → 401", async () => expect401(await send("post", url)));

    it("expired token → 401", async () => {
      const res = await send("post", url, { token: expiredToken() });
      expect401(res);
      expect(res.body.code).toBe("token_expired");
    });

    it("valid token (recipient) → auth passes (non-401)", async () => {
      seedFixtureStream(senderKp.publicKey(), recipientKp.publicKey());
      const recipientToken = makeValidToken(recipientKp.publicKey());
      expectAuthPassed(await send("post", url, { token: recipientToken }));
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  //  9. PATCH /api/streams/:id/start-time
  // ══════════════════════════════════════════════════════════════════════════

  describe("PATCH /api/streams/:id/start-time", () => {
    const url  = `/api/streams/${FIXTURE_STREAM_ID}/start-time`;
    const body = { startAt: Math.floor(Date.now() / 1000) + 7200 };

    it("no token → 401", async () => expect401(await send("patch", url, { body })));

    it("expired token → 401", async () => {
      const res = await send("patch", url, { token: expiredToken(), body });
      expect401(res);
      expect(res.body.code).toBe("token_expired");
    });

    it("valid token → auth passes (non-401)", async () => {
      seedFixtureStream(senderKp.publicKey(), recipientKp.publicKey());
      expectAuthPassed(await send("patch", url, { token: strangerToken(), body }));
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  //  10. GET /api/webhooks/dead-letters
  // ══════════════════════════════════════════════════════════════════════════

  describe("GET /api/webhooks/dead-letters", () => {
    const url = "/api/webhooks/dead-letters";

    it("no token → 401", async () => expect401(await send("get", url)));

    it("expired token → 401", async () => {
      const res = await send("get", url, { token: expiredToken() });
      expect401(res);
      expect(res.body.code).toBe("token_expired");
    });

    it("valid token → 200", async () => {
      const res = await send("get", url, { token: senderToken() });
      expectAuthPassed(res);
      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  //  11. GET /api/webhooks/dead-letters/count
  // ══════════════════════════════════════════════════════════════════════════

  describe("GET /api/webhooks/dead-letters/count", () => {
    const url = "/api/webhooks/dead-letters/count";

    it("no token → 401", async () => expect401(await send("get", url)));

    it("expired token → 401", async () => {
      const res = await send("get", url, { token: expiredToken() });
      expect401(res);
      expect(res.body.code).toBe("token_expired");
    });

    it("valid token → 200 with numeric total", async () => {
      const res = await send("get", url, { token: senderToken() });
      expectAuthPassed(res);
      expect(res.status).toBe(200);
      expect(typeof res.body.total).toBe("number");
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  //  12. POST /api/webhooks/dead-letters/:id/requeue
  // ══════════════════════════════════════════════════════════════════════════

  describe("POST /api/webhooks/dead-letters/:id/requeue", () => {
    const url = `/api/webhooks/dead-letters/${FIXTURE_DL_ID}/requeue`;

    beforeAll(() => {
      seedDeadLetterFixture();
    });

    it("no token → 401", async () => expect401(await send("post", url)));

    it("expired token → 401", async () => {
      const res = await send("post", url, { token: expiredToken() });
      expect401(res);
      expect(res.body.code).toBe("token_expired");
    });

    it("valid token → 200", async () => {
      seedDeadLetterFixture();
      const res = await send("post", url, { token: senderToken() });
      expectAuthPassed(res);
      expect(res.status).toBe(200);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  //  13. Admin route: DELETE /api/streams/:id  (adminAuth middleware)
  //
  //  The issue acceptance criteria says "no key → 403". The implementation
  //  in src/middleware/adminAuth.ts actually returns 401. Tests assert the
  //  real behaviour. Update expect401() → expect403() if the middleware is
  //  ever changed to comply with the spec.
  // ══════════════════════════════════════════════════════════════════════════

  describe("DELETE /api/streams/:id (adminAuth)", () => {
    const url = `/api/streams/${FIXTURE_STREAM_ID}`;

    it("no X-Admin-Key header → 401", async () => {
      seedFixtureStream(senderKp.publicKey(), recipientKp.publicKey());
      expect401(await send("delete", url));
    });

    it("wrong X-Admin-Key → 401", async () => {
      seedFixtureStream(senderKp.publicKey(), recipientKp.publicKey());
      expect401(await send("delete", url, { adminKey: "wrong-key" }));
    });

    it("valid X-Admin-Key → 204 (stream deleted)", async () => {
      seedFixtureStream(senderKp.publicKey(), recipientKp.publicKey());
      const res = await send("delete", url, { adminKey: ADMIN_KEY });
      expect(res.status).toBe(204);
    });
  });

  // ══════════════════════════════════════════════════════════════════════════
  //  14. Token format edge cases
  //      (exercised against a read-only route to avoid mutation side-effects)
  // ══════════════════════════════════════════════════════════════════════════

  describe("Token format edge cases", () => {
    const url = "/api/webhooks/dead-letters/count";

    it("malformed token (not a JWT) → 401 invalid_token", async () => {
      const res = await send("get", url, { token: "not.a.real.jwt" });
      expect401(res);
      expect(res.body.code).toBe("invalid_token");
    });

    it("JWT signed with wrong secret → 401 invalid_token", async () => {
      const badToken = jwt.sign(
        { accountId: senderKp.publicKey() },
        "completely-wrong-secret",
        { expiresIn: "1h" },
      );
      const res = await send("get", url, { token: badToken });
      expect401(res);
      expect(res.body.code).toBe("invalid_token");
    });

    it("Basic scheme instead of Bearer → 401 unauthorized", async () => {
      const res = await request(app).get(url).set("Authorization", "Basic abc123");
      expect401(res);
      expect(res.body.code).toBe("unauthorized");
    });

    it("Bearer with empty token value → 401", async () => {
      const res = await request(app).get(url).set("Authorization", "Bearer ");
      expect401(res);
    });

    it("No Authorization header → 401 unauthorized", async () => {
      const res = await request(app).get(url);
      expect401(res);
      expect(res.body.code).toBe("unauthorized");
    });
  });
});
