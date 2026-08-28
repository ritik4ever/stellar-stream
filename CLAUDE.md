# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Quick Start

```bash
npm run install:all              # Install all dependencies (backend + frontend)
npm run dev:backend              # Start backend API on :3001 with auto-reload
npm run dev:frontend             # Start frontend on :3000 with hot reload
cd backend && npm run test       # Run backend tests with Vitest
cd frontend && npm run test      # Run frontend tests with Vitest
cd backend && npm run build      # TypeScript build (required before deployment)
cd frontend && npm run build     # Build production bundle
```

## Architecture

StellarStream models continuous payment streams where a sender allocates a total amount over a fixed duration and the recipient vests value over time. The app has three layers:

| Layer | Location | Port | Tech | Role |
|-------|----------|------|------|------|
| **Frontend** | `frontend/` | 3000 | React + Vite + Tailwind | Dashboard for creating and monitoring streams |
| **Backend API** | `backend/` | 3001 | Node.js + Express + SQLite | REST API + indexer + webhook worker |
| **Smart Contract** | `contracts/` | — | Rust + Soroban | On-chain stream logic (not yet integrated in MVP) |

### Backend Data Flow

1. **API Layer** (`backend/src/index.ts`): Express routes handle REST requests. Validation via Zod schemas in `backend/src/validation/schemas.ts`.
2. **Service Layer** (`backend/src/services/`):
   - `streamStore.ts`: Core business logic—stream lifecycle, progress calculations, archiving
   - `eventHistory.ts`: Persists stream events (created, claimed, canceled) in `stream_events` table
   - `indexer.ts`: Background worker polling Stellar for on-chain events (10s interval)
   - `webhookWorker.ts`: Background worker delivering webhooks with retry logic
   - `reconciliationJob.ts`: Reconciles local stream state with Stellar chain
   - `cache.ts`: In-memory LRU cache for stream lookups
3. **Database Layer** (`backend/src/services/db.ts`): SQLite with WAL mode, uses `better-sqlite3`.
4. **Frontend** polls `/api/streams` every 5 seconds (target: WebSocket push updates).

### Database Schema

Key tables:
- `streams`: Active stream records (sender, recipient, asset, amount, duration, start_at, archived_at, etc.)
- `stream_archive`: Historical archive of completed/canceled streams
- `stream_events`: Immutable event log (created, claimed, canceled, etc.)
- `webhook_deliveries`: Pending webhook deliveries with retry metadata
- `webhook_dead_letters`: Failed webhook deliveries for manual inspection
- `indexer_cursor`: Tracks last ledger sequence polled from Stellar

**Important fields:**
- `archived_at`: NULL for active streams; timestamp when archived (streams older than 30 days are eligible)
- `paused_at` / `paused_duration`: Handle stream pause logic
- `metadata`: JSON field for extensibility

### Key Concepts

**Stream Status**: Computed real-time from timestamps—`scheduled`, `active`, `paused`, `completed`, `canceled`.

**Progress Calculation** (`calculateProgress()` in `streamStore.ts`):
- `elapsedSeconds = now - startAt - pausedDuration`
- `vestedAmount = min(totalAmount, (elapsedSeconds / durationSeconds) * totalAmount)`
- `percentComplete = vestedAmount / totalAmount`

**Archiving**: `archiveOldStreams()` moves streams with `completed_at || canceled_at` older than 30 days to `stream_archive` (configurable cron).

**Webhooks**: On each stream event, `triggerWebhook()` enqueues a delivery. The webhook worker retries with exponential backoff (max 3 attempts).

## Frontend Structure

- `src/App.tsx`: Root component, defines main routes and layout
- `src/hooks/useWebSocket.ts`: Manages WebSocket connections with exponential backoff reconnect (currently not used for stream updates)
- `src/services/`: API client wrappers (stream CRUD, event history)
- `src/components/`: Reusable UI components
- `src/types/`: TypeScript interfaces
- **Current polling model**: Frontend calls `GET /api/streams?q=...&status=...` every 5 seconds

## Testing

**Backend:**
- Test files: `*.test.ts` and `*.integration.test.ts` in `backend/src/`
- Run all: `cd backend && npm run test`
- Run single test: `cd backend && npx vitest run src/services/streamStore.test.ts`
- CI runs: `npx vitest run --coverage` (also builds TypeScript)

**Frontend:**
- Test files: `*.test.ts` / `*.test.tsx` in `frontend/src/`
- Run all: `cd frontend && npm run test`
- E2E tests: `npm run test:e2e` (Playwright)

## CI/CD

**Workflows** (`.github/workflows/`):
- `ci.yml`: Frontend + backend build checks on every PR/push
- `backend-ci.yml`: Backend tests + coverage + build (on backend changes)
- `frontend-ci.yml`: Frontend linting + build (on frontend changes)
- `contract-ci.yml`: Rust contract tests
- `playwright-e2e.yml`: E2E test suite
- `codeql.yml`: Static security scan
- `gitleaks.yml`: Secret scanning

## Contract Build & WASM Optimization

The Soroban contract uses multi-level size optimization:

**Cargo Release Profile** (`contracts/Cargo.toml`):
- `opt-level = "z"` - Optimize for minimal size
- `lto = true` - Link-time optimization across all dependencies
- `strip = "symbols"` - Remove debug symbols
- `codegen-units = 1` - Maximum optimization opportunities
- `panic = "abort"` - Minimal panic handling

**wasm-opt Post-Build** (`contracts/build.rs`):
- Automatically runs on `soroban contract build` (release mode)
- Uses wasm-opt `-O4` (aggressive size reduction, ~10-15% additional)
- Requires: `npm install -g wasm-opt` or `brew install binaryen`

**Build Commands**:
```bash
cd contracts
make build              # Standard build with Cargo
make build-optimized   # Build + explicit wasm-opt -O4
make profile-size      # Show current binary size
make test              # Run contract tests
```

**Size Tracking**: See `SIZE_PROFILE.md` for baseline metrics and optimization history.

## Code Patterns

**Parameter Binding in SQL**: Use `@name` syntax for `better-sqlite3` prepared statements (not `?`):
```typescript
db.prepare("SELECT * FROM streams WHERE sender = @sender").run({ sender: "G..." });
```

**Error Handling**: Use `sendApiError(req, res, statusCode, message, { code: "ERROR_CODE" })` for consistent error responses.

**Rate Limiting**: Applied via Express middleware (`rateLimit`). Configurable per-endpoint via env vars: `READ_RATE_LIMIT`, `MUTATION_RATE_LIMIT`, `AUTH_CHALLENGE_RATE_LIMIT`, `CLAIMABLE_RATE_LIMIT`.

**Validation**: Zod schemas in `backend/src/validation/schemas.ts`. Parse, transform, and refine before passing to services.

**Caching**: Use `getCache()` to access the in-memory LRU cache. Call `resetStatsCache()` after mutations affecting stats.

**Migrations**: New schema changes go in the `migrate()` function in `db.ts`. Use incremental `addColumnIfMissing()` pattern for backwards compatibility.

## Configuration

**Backend env vars** (see `.env` or GitHub Actions):
- `PORT`: API port (default: 3001)
- `DB_PATH`: SQLite file path (default: `data/streams.db`)
- `ALLOWED_ASSETS`: CSV list of allowed assets (default: `USDC,XLM`)
- `ARCHIVE_CRON_INTERVAL_MS`: Cron interval for archiving (default: daily)
- `ALLOWED_ORIGINS`: CORS allowed origins (CSV)
- `READ_RATE_LIMIT`, `MUTATION_RATE_LIMIT`: Per-minute limits (defaults: 120, 10)
- `STELLAR_NETWORK`: `testnet` or `public` (default: `testnet`)
- Soroban contract address, webhook signing key, etc.

**Frontend env vars**:
- `VITE_API_BASE_URL`: Backend API URL (default: http://localhost:3001)
- `VITE_STELLAR_NETWORK`: `testnet` or `public`

## Important Files to Know

| File | Purpose |
|------|---------|
| `backend/src/index.ts` | Express app, all route handlers |
| `backend/src/services/streamStore.ts` | Stream CRUD, progress, archive logic |
| `backend/src/services/db.ts` | SQLite init and schema migrations |
| `backend/src/validation/schemas.ts` | Zod request/response validation |
| `backend/src/swagger.ts` | OpenAPI 3.0 spec (auto-generated from code) |
| `frontend/src/App.tsx` | React root, routing |
| `frontend/src/hooks/useWebSocket.ts` | WebSocket client hook |
| `MAINTAINER_GUIDE.md` | Issue triage, PR review, release checklists |

## Pragmas and Performance

SQLite WAL mode and related pragmas are applied in `backend/src/services/sqlite/` (see `docs/adr/0006-sqlite-wal-and-pool-tuning.md`):
- `PRAGMA journal_mode=WAL`: Concurrent reads during writes
- `PRAGMA synchronous=NORMAL`: Balance durability and speed
- `PRAGMA busy_timeout=5000`: Prevent SQLITE_BUSY on concurrent writes
- `PRAGMA cache_size=-64000`: 64MB page cache for read perf

## Security Notes

- **Rate limiting** protects mutation endpoints from abuse
- **Helmet** sets HSTS, CSP, and other HTTP headers
- **CORS** is configurable via `ALLOWED_ORIGINS` env var
- **Auth**: JWT-based challenge-response (optional, per route via `authMiddleware`)
- **Webhook signing**: HMAC-SHA256 in `webhookSignature.ts`
- **SQL injection**: Prevented by parameterized queries (`@name` binding)
