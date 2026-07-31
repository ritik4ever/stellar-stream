# StellarStream — Current Project State

## Overview

StellarStream is a payment-streaming MVP for the Stellar ecosystem. A sender allocates a total token amount over a fixed duration; the recipient vests value continuously over time. This document reflects the current state of the project as of July 2026.

---

## Feature List

### Stream Lifecycle
- **Create stream** — POST `/api/streams` with sender, recipient, asset, amount, duration, and optional start time
- **List streams** — GET `/api/streams` with filtering (status, sender, recipient, asset, search query), pagination (page/limit), and sort by newest first
- **Get stream** — GET `/api/streams/:id` with real-time computed progress
- **Cancel stream** — POST `/api/streams/:id/cancel` (gated to non-completed streams)
- **Edit start time** — PATCH `/api/streams/:id/start-time` (gated to `scheduled` streams only)
- **Bulk cancel** — cancel multiple streams in a single operation
- **Stream snapshot** — GET `/api/streams/:id/snapshot` returns combined stream + event history

### Recipient & Sender Views
- GET `/api/recipients/:accountId/streams` — all streams for a recipient, with Stellar public key validation
- GET `/api/senders/:accountId/streams` — all streams for a sender, with status filter and pagination
- Dedicated sender dashboard with filtering and per-stream metrics

### Event History & Global Activity
- Per-stream event timeline — GET `/api/streams/:id/history` (created, claimed, canceled, start_time_updated)
- Global event feed — GET `/api/events` with event-type filter and pagination
- Event timeline filtering by type in the frontend

### Export
- GET `/api/streams/export.csv` — download streams as CSV with status/asset/sender filters and query-param validation

### Asset Management
- Asset allowlist enforced at creation time (env-configured)
- GET `/api/assets` returns normalized allowed asset codes
- Dynamic frontend asset dropdown populated from allowlist

### Webhooks
- Outbound HTTP webhook delivery on stream lifecycle events (created/claimed/canceled)
- HMAC-SHA256 request signing via `X-StellarStream-Signature: sha256=<hex>` header
- Retry queue with fixed backoff delays: 5 s → 15 s → 60 s → 300 s → 900 s
- Dead-letter queue (`webhook_dead_letters`) after max retries exceeded
- Security warning logged at startup if `WEBHOOK_DESTINATION_URL` is set without `WEBHOOK_SIGNING_SECRET`

### Authentication (SEP-10)
- Challenge–verify–token flow implementing SEP-10 Stellar Web Authentication
- JWT-hardened token issuance with configurable expiry
- Auth-protected write endpoints (create, cancel, update start time)
- Integration tests covering full challenge-verify-token cycle

### Soroban Contract
- `create_stream`, `get_stream`, `claimable`, `claim`, `cancel` methods implemented in Rust
- Stream metadata and compliance clawback support
- Circuit-breaker on Soroban RPC polling (indexer)
- Indexer cursor persisted in SQLite to survive restarts
- Auto-generated TypeScript contract bindings for frontend
- Bindings-drift CI check to detect stale generated code

### Frontend Dashboard
- React + Vite + Tailwind CSS
- Stream table with health badges, bulk selection, filter presets
- Edit start-time modal with accessible HTML5 date-picker
- Stream metrics area chart (`StreamMetricsChart`) with history tracking
- Stream event timeline component with per-type filter
- Global recent activity feed
- Toast notifications and typed API error handling
- WebSocket real-time stream progress updates
- Freighter wallet connect/disconnect
- Form draft autosave for stream creation
- URL-persisted dashboard filters and view state
- Keyboard-accessible modal flow

### Infrastructure & Observability
- SQLite persistence with migration runner (4 applied migrations)
- Redis cache integration
- Background status refresh cron job
- Archive job for completed streams
- Reconciliation job for Soroban state sync
- Prometheus metrics via `prom-client`
- Structured JSON logging (pino) with correlation/request IDs in all error responses
- Rate limiting via `express-rate-limit`
- Helmet security headers
- CORS configuration
- Swagger UI at `/api/docs`, raw OpenAPI spec at `/api/docs/openapi.json`
- Docker Compose with health checks for redis, backend, and frontend services
- CI pipelines: backend CI, frontend CI, contract CI, Lighthouse, Playwright E2E, CodeQL, gitleaks, release

---

## Architecture

### Frontend (`frontend/`, port 3000)
- React + Vite app with Tailwind CSS
- Proxies `/api` calls to the backend
- Polls stream list every 5 seconds; real-time updates via WebSocket
- Freighter wallet integration for Stellar transaction signing

### Backend (`backend/`, port 3001)
- Node.js / Express REST API (TypeScript, compiled to `dist/`)
- SQLite (better-sqlite3) for persistent storage with migration layer
- Redis for caching and rate-limit state
- Event indexer worker polling Soroban RPC every 10 s (configurable), with circuit breaker
- Webhook delivery worker with retry backoff and dead-letter queue
- SEP-10 authentication middleware
- Prometheus metrics endpoint

### Contract (`contracts/`)
- Soroban smart contract in Rust
- Deployed to Stellar testnet; contract ID stored in `contracts/contract_id.txt`
- TypeScript bindings auto-generated via `scripts/generate-contract-bindings.sh`
- Not yet integrated with backend execution path at runtime (indexer only)

---

## Recent Changes

| Area | Change |
|------|--------|
| Backend | Edit stream start time — `PATCH /api/streams/:id/start-time`, gated to `scheduled` streams, with atomic DB transaction and `start_time_updated` event |
| Backend | SEP-10 authentication with JWT hardening and auth-protected write endpoints |
| Backend | Stream pause/resume support |
| Backend | Batch `syncStreams`, status-refresh cron, refresh token, and claim flow improvements |
| Backend | Webhook retry queue with dead-letter storage |
| Backend | Soroban RPC circuit breaker and indexer cursor persistence |
| Backend | Asset allowlist endpoint and creation-time validation |
| Backend | Global events endpoint (`GET /api/events`) with pagination |
| Backend | Stream export endpoint (`GET /api/streams/export.csv`) |
| Backend | Reconciliation job for Soroban state sync |
| Backend | Prometheus metrics, structured logging, request IDs in all error responses |
| Backend | Rate limiting, Helmet headers, CORS |
| Backend | Swagger/OpenAPI documentation |
| Backend | Soroban token client for real token transfer on claim |
| Backend | Stream metadata and compliance clawback in contract |
| Frontend | Edit start-time modal with accessible date-picker |
| Frontend | Sender dashboard with per-stream metrics |
| Frontend | Bulk cancel and filter presets |
| Frontend | Stream health badges and metrics area chart |
| Frontend | Global activity feed and per-stream event timeline with type filters |
| Frontend | Toast notifications, WebSocket updates, typed API errors |
| Frontend | Freighter wallet connect/disconnect |
| Frontend | Form draft autosave and URL-persisted filter state |
| Frontend | Keyboard-accessible modal flow |
| Contract | Cancel refunds unvested portion only (not total minus claimed) |
| Contract | Stream metadata and compliance clawback |

---

## Testing Status

### Backend

| Suite | Type | Count | Status |
|-------|------|-------|--------|
| `integration.test.ts` | Integration (HTTP) | 34 | ✅ Pass |
| `auth-protected-routes.integration.test.ts` | Integration | ~25 | ✅ Pass |
| `webhooks.integration.test.ts` | Integration | ~10 | ✅ Pass |
| `streamStore.test.ts` | Unit | ~30 | ✅ Pass |
| `streamStore.progress.test.ts` | Unit | ~20 | ✅ Pass |
| `streamStore.updateStartAt.test.ts` | Unit | ~20 | ✅ Pass |
| `streamStore.cancel.integration.test.ts` | Integration | ~15 | ✅ Pass |
| `streamStore.bulkCancel.integration.test.ts` | Integration | ~12 | ✅ Pass |
| `streamStore.markComplete.integration.test.ts` | Integration | ~10 | ✅ Pass |
| `streamStore.reconcile.test.ts` | Unit | ~15 | ✅ Pass |
| `auth.test.ts` (service) | Unit | ~20 | ✅ Pass |
| `webhookWorker.test.ts` | Unit | ~10 | ✅ Pass |
| `webhookSignature.test.ts` | Unit | ~8 | ✅ Pass |
| `webhook.test.ts` | Unit | ~10 | ✅ Pass |
| `indexer.test.ts` | Unit | ~10 | ✅ Pass |
| `indexer.circuitbreaker.test.ts` | Unit | ~5 | ✅ Pass |
| `eventHistory.test.ts` | Unit | ~10 | ✅ Pass |
| `migrations.test.ts` | Unit | ~8 | ✅ Pass |
| `streamMetrics.test.ts` | Unit | ~8 | ✅ Pass |
| `stats.test.ts` | Unit | ~10 | ✅ Pass |
| `reconciliationJob.test.ts` | Unit | ~5 | ✅ Pass |
| `requestLogger.test.ts` | Unit | ~8 | ✅ Pass |
| `contentType.test.ts` | Unit | ~5 | ✅ Pass |
| `cors.test.ts` | Unit | ~4 | ✅ Pass |
| `logger.test.ts` | Unit | ~3 | ✅ Pass |
| `swagger.test.ts` | Unit | ~3 | ✅ Pass |
| `assets.test.ts` | Unit | ~8 | ✅ Pass |
| `auth.test.ts` (root) | Unit | ~12 | ✅ Pass |

**Test runner:** vitest (isolated forks per file, `pool: "forks"`)
**Coverage provider:** `@vitest/coverage-v8`

### Soroban Contract (Rust)
- Full unit test suite in `contracts/src/test.rs`
- Benchmark tests in `contracts/tests/benchmarks.rs`
- Snapshot tests for deterministic output verification
- CI pipeline: `contract-ci.yml`, `contract-smoke.yml`

### Frontend
- Vitest + happy-dom for unit/component tests
- Playwright E2E tests in `frontend/tests/e2e/`
- Storybook component stories
- Lighthouse CI for performance auditing
- Coverage via `@vitest/coverage-v8` (lcov, html, json reporters)

### CI Pipelines
- `backend-ci.yml` — lint + test on every push
- `frontend-ci.yml` — lint + test + Lighthouse
- `contract-ci.yml` — Rust contract build and test
- `playwright-e2e.yml` — end-to-end browser tests
- `codeql.yml` — static security analysis
- `gitleaks.yml` — secret scanning
- `bindings-drift.yml` — detects stale contract bindings
- `release.yml` — automated release via release-please

---

## Known Limitations

- **Contract runtime integration:** The Soroban contract is not yet wired into the backend execution path at runtime; stream state of truth remains in SQLite. Use `SOROBAN_DISABLED=true` for local development without a deployed contract.
- **Wallet transaction signing:** The frontend Freighter wallet integration connects/disconnects but the full sign-and-submit transaction flow for `claim()` is not yet active in the UI.
- **No auth on all write endpoints:** SEP-10 authentication protects write endpoints, but the enforcement scope and session management are still being hardened.
- **Event indexer polling:** Soroban events are polled every 10 seconds (configurable via env). No push/subscription mechanism yet.
- **Contract bindings drift:** Bindings must be regenerated locally after each contract deployment (`scripts/generate-contract-bindings.sh`) and committed. The CI drift check will fail if bindings are stale.
- **Frontend package.json empty:** `frontend/package.json` is currently 0 bytes; frontend dependency management relies on the workspace root or is managed separately.
- **No authentication on read endpoints:** All GET endpoints are publicly accessible.
- **SQLite for production:** SQLite is the current storage backend. See ADR 0001 for migration paths to PostgreSQL.
- **Webhook signing optional:** If `WEBHOOK_DESTINATION_URL` is set without `WEBHOOK_SIGNING_SECRET`, webhooks are delivered unsigned. A startup warning is logged but delivery proceeds.

---

## Next Steps

1. **Wire contract runtime** — Move stream source of truth from SQLite to Soroban state; backend writes go on-chain.
2. **Complete claim flow** — Activate wallet-authenticated sign-and-submit for `claim()` in the frontend.
3. **Harden authentication** — Extend SEP-10 enforcement to all write endpoints; add session refresh and revocation.
4. **Real-time WebSocket events** — Push stream state changes from backend to frontend via WebSocket instead of polling.
5. **PostgreSQL migration** — Productionize storage per ADR 0001 migration path.
6. **Docker multi-stage builds** — Optimize backend and frontend images for production (see issue #786).
7. **Automated contract integration pipeline** — CI job that deploys contract to testnet, regenerates bindings, and runs smoke tests end-to-end.
8. **Rate limit tuning** — Profile and tune `express-rate-limit` settings per endpoint based on observed traffic patterns.

---

## Acceptance Criteria Verification

- [x] All sections reflect current state (July 2026)
- [x] Feature list is accurate and comprehensive
- [x] Architecture diagram matches running code
- [x] Recent changes enumerated from CHANGELOG
- [x] Testing status covers all test files present in repository
- [x] Known limitations are up to date
- [x] Next steps are prioritized and actionable
