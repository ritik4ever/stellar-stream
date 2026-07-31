# Integration Tests Summary

## Overview

StellarStream has **184 integration tests** across **6 test files** in the backend, covering the complete REST API surface including auth, stream lifecycle, webhooks, and rate limiting.

| Layer | Test Files | Test Count |
|-------|-----------|------------|
| Backend integration tests | 6 files | **184 tests** |
| Backend unit tests | 27 files | **~316 tests** |
| Frontend tests | 25 files | **~249 tests** |
| **Total** | **58 files** | **~749 tests** |

---

## Coverage: Covered vs Planned

### ✅ Covered Flows

#### 1. Main API (`backend/src/integration.test.ts`) — 113 tests
- **Health check** — service status, security headers (CSP, HSTS, X-Frame-Options, etc.)
- **GET /api/streams** — list, filter by status/sender/recipient/asset/assetCode (single + multiple + case-insensitive), search (q), pagination, soft-delete, sort/order (totalAmount, startAt, createdAt, durationSeconds), validation errors
- **GET /api/streams/:id** — get, 404, 400 for invalid ID
- **GET /api/streams/:id/claimable** — Soroban simulation, paused/canceled returns 0, rate limit (30/min)
- **GET /api/recipients/:accountId/streams** — list, filter by status/sender/asset/assetCode/q, empty, invalid account validation (not G, wrong length)
- **GET /api/senders/:accountId/streams** — list, filter by status, pagination, empty, invalid account
- **GET /api/streams/sender/:address** — list, pagination, filter by status, empty, validation
- **GET /api/streams/recipient/:address** — list, pagination, filter by status, empty, validation
- **POST /api/streams/:id/claim** — recipient claim, non-recipient 403, double-claim protection, concurrent double-spend prevention
- **POST /api/streams/:id/reconcile** — on-chain reconciliation, 404 on-chain not found, rate limit (5/stream/min)
- **GET /api/streams/:id/history** — event history, 404, stream_completed event recording
- **GET /api/streams/:id/snapshot** — stream + history combined, 404
- **GET /api/events** — list, filter by eventType/streamId/since, pagination (offset + cursor-based), combined filters, pageSize
- **GET /api/streams/export.csv** — full export, filter by status/asset/sender
- **GET /api/assets** — list allowed assets, normalized (uppercase)
- **POST /api/streams** — mutation rate limit (10/min)
- **Error handling** — database error graceful handling

#### 2. Auth-Protected Routes (`backend/src/auth-protected-routes.integration.test.ts`) — 44 tests
- **14 route groups** — fee-estimate, create stream, cancel, mark-complete, pause, resume, reconcile, claim, start-time, dead-letters (list + count + requeue), admin delete
- Each route tested with: no token → 401, expired token → 401, valid token → passes
- Admin routes: no X-Admin-Key → 401, wrong key → 401, valid key → 204
- Token format edge cases: malformed JWT, wrong secret, Basic scheme, empty Bearer, no header

#### 3. Cancel Stream (`backend/src/services/streamStore.cancel.integration.test.ts`) — 7 tests
- Cancel active stream, idempotent cancel, nonexistent stream, cancel completed stream
- Authorization: non-sender → 403, no auth → 401
- Event history: exactly one canceled event recorded

#### 4. Bulk Cancel (`backend/src/services/streamStore.bulkCancel.integration.test.ts`) — 7 tests
- Cancel multiple streams with partial failures, max 20 IDs limit, empty IDs
- Auth: sender mismatch → 403, no auth → 401, non-sender per-stream failure
- Serial cancellation with full success

#### 5. Mark Complete (`backend/src/services/streamStore.markComplete.integration.test.ts`) — 7 tests
- Mark fully-vested paused stream as completed
- Not fully vested → 400, already completed → 400, already canceled → 400
- Non-sender → 403, nonexistent stream → 404, no auth → 401

#### 6. Webhook Dead Letters (`backend/src/webhooks.integration.test.ts`) — 6 tests
- List dead letters (empty, with data), pagination
- Count endpoint, requeue dead letter, 404 for nonexistent

### 🔲 Planned / Future Coverage
- [ ] WebSocket event broadcasting
- [ ] Indexer background job integration
- [ ] Webhook delivery (successful delivery flow)
- [ ] Performance / load tests
- [ ] Frontend integration tests (E2E via Playwright — see `npm run test:e2e`)
- [ ] Contract (Soroban) integration

---

## Running Integration Tests

```bash
# All backend tests (unit + integration)
cd backend && npm test

# Integration tests only
cd backend && npx vitest run src/integration.test.ts
cd backend && npx vitest run src/**/*.integration.test.ts

# Single integration test file
cd backend && npx vitest run src/services/streamStore.cancel.integration.test.ts

# With coverage
cd backend && npx vitest run --coverage

# Frontend tests
cd frontend && npm test

# E2E tests (Playwright)
npm run test:e2e
```

### Test Configuration

The test suite uses:
- **Vitest** with `pool: "forks"` — each test file runs in its own forked process for full isolation
- **supertest** — real HTTP requests against the Express app (no port binding)
- **Separate SQLite databases** — each integration test file uses its own `.db` file in `backend/data/`
- **`src/test-setup.ts`** — sets env vars (SOROBAN_DISABLED, rate limit ceilings, JWT secret) before any module is imported

---

## How to Add a New Integration Test

### 1. Choose the Right File
- **New API endpoint** → add to `backend/src/integration.test.ts`
- **New auth-guarded route** → add to `backend/src/auth-protected-routes.integration.test.ts`
- **Stream mutation (cancel/mark-complete/etc.)** → add to or create a file like `streamStore.<feature>.integration.test.ts`

### 2. File Template

```typescript
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import request from "supertest";
import { app } from "../index";
import { initDb, getDb } from "./db";
import path from "path";
import fs from "fs";

const TEST_DB_PATH = path.join(__dirname, "..", "data", "test-my-feature.db");

describe("POST /api/my-feature Integration Tests", () => {
  beforeAll(() => {
    process.env.DB_PATH = TEST_DB_PATH;
    initDb();
  });

  beforeEach(() => {
    const db = getDb();
    db.exec("DELETE FROM stream_events");
    db.exec("DELETE FROM streams");
  });

  afterAll(() => {
    getDb().close();
    if (fs.existsSync(TEST_DB_PATH)) fs.unlinkSync(TEST_DB_PATH);
  });

  it("should handle a valid request", async () => {
    // Insert test data
    const db = getDb();
    db.prepare(`INSERT INTO streams (...) VALUES (...)`)....

    const response = await request(app)
      .post("/api/streams/1/my-feature")
      .send({ ... });

    expect(response.status).toBe(200);
    expect(response.body.data).toMatchObject({ ... });
  });

  it("should reject unauthorized requests", async () => {
    const response = await request(app)
      .post("/api/streams/1/my-feature");

    expect(response.status).toBe(401);
  });
});
```

### 3. Best Practices
- **Use a unique `TEST_DB_PATH`** per file to avoid cross-contamination
- **Clean up in `beforeEach`** — delete all rows from all tables
- **Test happy path first**, then error cases, then edge cases
- **Test auth** — no token, expired token, valid token (wrong role)
- **Use `pool: "forks"`** — already configured in `vitest.config.ts`, ensures full isolation
- **Set env vars in `test-setup.ts`** if you need module-level env overrides

### 4. Register in CI
Integration tests run as part of `cd backend && npm test` via vitest's `include` glob (`src/**/*.test.ts`). No additional registration needed.

---

## Test Results

Last run: All 184 integration tests pass. CI runs on every push/PR via `.github/workflows/backend-ci.yml`.

```
✓ 184 integration tests passed
✓ 0 tests failed
✓ ~3-5s total duration
✓ Isolated databases, no external dependencies
```
