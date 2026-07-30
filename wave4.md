# Wave 4 — StellarStream Deliverables

Wave 4 focused on **production hardening, advanced streaming features, DeFi integrations, and developer
experience** improvements across all three layers of the stack. All 50 planned items were shipped and
merged into `main` by April 2026 (see CHANGELOG.md for commit references).

## Themes

| Theme | Scope |
|---|---|
| **Contract** | Cliff vesting · multi-recipient split streams · pause/resume · compliance clawback · stream transfer |
| **Backend** | Soroban RPC reliability · exponential backoff · webhook integrity · auth hardening · admin operations |
| **Frontend** | WebSocket real-time updates · dark mode · bulk operations · richer UX |
| **Infra** | Docker Compose · CI coverage · observability foundations |

## Timeline

> Wave 4 ran from **February 2026** through **April 2026** (≈ 10 weeks). The contract layer landed first
> (weeks 1-4), backend hardening in the middle (weeks 4-7), and frontend polish closed the wave (weeks 7-10).

---

## Smart Contract (`contracts/src/lib.rs`)

| # | Deliverable | Status | Shipped |
|---|---|---|---|
| C-1 | Cliff vesting: `cliff_seconds` field on `Stream`; vested amount returns 0 before cliff | ✅ Done | Week 2 |
| C-2 | Multi-recipient split streams: `create_split_stream`, `SplitChildren` / `ChildToParent` storage keys | ✅ Done | Week 4 |
| C-3 | Stream pause / resume contract functions with time-extension model (`pause_started_at`) | ✅ Done | Week 4 |
| C-4 | Compliance clawback mechanism (`clawback`), admin-only, emits `ClawbackExecuted` event | ✅ Done | Week 3 |
| C-5 | Native XLM streaming via `NATIVE_SENTINEL` sentinel address in token client | ✅ Done | Week 3 |
| C-6 | On-chain stream metadata: `Option<Map<String, String>>` field, surfaced in `StreamCreated` event | ✅ Done | Week 3 |
| C-7 | Stream transfer (`transfer_stream`): change recipient, emits `StreamTransferred` event | ✅ Done | Week 4 |
| C-8 | Richer `StreamCreated` event payload: includes `token_symbol`, `cliff_seconds`, `metadata` | ✅ Done | Week 3 |
| C-9 | `get_claimable_batch`: query claimable amounts for multiple stream IDs in one call | ✅ Done | Week 5 |
| C-10 | SAC (Stellar Asset Contract) token allowlist: `add_allowed_token` / `remove_allowed_token` | ✅ Done | Week 3 |
| C-11 | Fuzz / boundary tests for `vested_amount` across cliff, pause, and cancel edge cases | ✅ Done | Week 5 |
| C-12 | Cancel-then-claim integration test; refund is unvested portion only (bug fix confirmed) | ✅ Done | Week 5 |
| C-13 | Concurrent claim test; `StreamCreated` event snapshot test | ✅ Done | Week 5 |
| C-14 | Real token transfer on `claim` via `soroban_sdk::token::Client` | ✅ Done | Week 3 |

---

## Backend Services

### Stream Store (`backend/src/services/streamStore.ts`)

| # | Deliverable | Status | Shipped |
|---|---|---|---|
| B-1 | RPC response caching in `syncStreams` using LRU in-memory cache | ✅ Done | Week 5 |
| B-2 | Retry with exponential backoff in `createStream` (`retryWithBackoff` / `SorobanSubmitError`) | ✅ Done | Week 5 |
| B-3 | Cancel refund amount captured from on-chain response and stored as `refunded_amount` | ✅ Done | Week 6 |
| B-4 | `pauseStream` / `resumeStream` backend functions wired to contract calls | ✅ Done | Week 5 |
| B-5 | Batch `get_stream` calls in `syncStreams` via `p-limit` concurrency limiter | ✅ Done | Week 5 |
| B-6 | Stream archival after 30 days: `archiveOldStreams()` moves rows to `stream_archive` | ✅ Done | Week 6 |
| B-7 | Configurable cron for `refreshStreamStatuses` via `ARCHIVE_CRON_INTERVAL_MS` env var | ✅ Done | Week 6 |
| B-8 | Fee estimation endpoint: `estimateCreateStreamFee()` surfaced at `POST /api/streams/estimate-fee` | ✅ Done | Week 7 |
| B-9 | `getOnChainClaimableBatch` for querying multiple stream IDs in one RPC call | ✅ Done | Week 6 |

### Auth (`backend/src/services/auth.ts`)

| # | Deliverable | Status | Shipped |
|---|---|---|---|
| A-1 | SEP-10 challenge / verify / JWT issue flow with replay-attack prevention (nonce + timestamp) | ✅ Done | Week 4 |
| A-2 | Refresh token endpoint (`POST /api/auth/refresh`) | ✅ Done | Week 5 |
| A-3 | Rate limiting on `POST /api/auth/challenge` via `AUTH_CHALLENGE_RATE_LIMIT` env var | ✅ Done | Week 5 |
| A-4 | Multi-sig challenge verification in `verifyChallengeAndIssueToken` | ✅ Done | Week 5 |
| A-5 | JWT secret rotation warning on startup; ephemeral secret in dev, hard error in production | ✅ Done | Week 5 |

### Event History (`backend/src/services/eventHistory.ts`)

| # | Deliverable | Status | Shipped |
|---|---|---|---|
| E-1 | Pagination for `getStreamHistory` (`page` + `limit` query params, max 200) | ✅ Done | Week 6 |
| E-2 | Record `claimed` events from contract indexer | ✅ Done | Week 6 |
| E-3 | Event deduplication by ledger sequence in indexer | ✅ Done | Week 6 |
| E-4 | Aggregated event counts endpoint (`GET /api/streams/:id/events/summary`) | ✅ Done | Week 7 |

### Indexer (`backend/src/services/indexer.ts`)

| # | Deliverable | Status | Shipped |
|---|---|---|---|
| I-1 | Cursor-based pagination in indexer (persisted `indexer_cursor` in SQLite) | ✅ Done | Week 4 |
| I-2 | Circuit breaker for RPC failures (CLOSED → OPEN → HALF\_OPEN state machine) | ✅ Done | Week 7 |
| I-3 | Prometheus metrics: `eventsIndexedTotal`, `ledgersScannedTotal`, `lastIndexedLedger`, `indexerErrorsTotal`, `indexerCircuitState` | ✅ Done | Week 7 |
| I-4 | Configurable start ledger for backfill via `INDEXER_START_LEDGER` env var | ✅ Done | Week 6 |

### API / Validation (`backend/src/index.ts`, `backend/src/validation/schemas.ts`)

| # | Deliverable | Status | Shipped |
|---|---|---|---|
| V-1 | Query param validation on `GET /api/streams/export.csv` (Zod schema) | ✅ Done | Week 7 |
| V-2 | `DELETE /api/streams/:id` admin endpoint behind `adminAuth` middleware | ✅ Done | Week 7 |
| V-3 | Request ID in all error responses (`x-request-id` header, `requestId` field in body) | ✅ Done | Week 7 |
| V-4 | `GET /api/stats` aggregate endpoint (`getGlobalStats`) | ✅ Done | Week 7 |
| V-5 | Stellar account ID validation in schemas using `StrKey.isValidEd25519PublicKey` | ✅ Done | Week 7 |
| V-6 | Webhook registration schema (Zod, `webhookRegistrationSchema`) | ✅ Done | Week 6 |
| V-7 | Prometheus metrics scrape endpoint (`GET /metrics`) with optional Basic Auth | ✅ Done | Week 8 |
| V-8 | Asset allowlist management: `GET/POST/DELETE /api/allowed-assets` (admin-protected) | ✅ Done | Week 7 |

### Webhooks (`backend/src/services/webhook.ts`, `webhookWorker.ts`)

| # | Deliverable | Status | Shipped |
|---|---|---|---|
| W-1 | HMAC-SHA256 webhook signatures (`X-StellarStream-Signature: sha256=<hex>`) | ✅ Done | Week 4 |
| W-2 | Webhook retry queue with exponential backoff (max 3 attempts, configurable delays) | ✅ Done | Week 4 |
| W-3 | Dead-letter storage (`webhook_dead_letters` table) + requeue endpoint | ✅ Done | Week 6 |

---

## Frontend

| # | Deliverable | Status | Shipped |
|---|---|---|---|
| F-1 | Dark mode toggle with `localStorage` persistence (`DarkModeToggle`, `useTheme`) | ✅ Done | Week 8 |
| F-2 | WebSocket client (`useWebSocket` hook) with exponential backoff reconnect | ✅ Done | Week 7 |
| F-3 | WebSocket server-push stream progress (`streamProgressBroadcaster`, `/api/ws`) | ✅ Done | Week 8 |
| F-4 | Global toast notification system (`useToast`, `Toast` component) | ✅ Done | Week 8 |
| F-5 | Asset selector dropdown in `CreateStreamForm` populated from `/api/assets` | ✅ Done | Week 8 |
| F-6 | End date/time preview in `CreateStreamForm` (computed from start + duration) | ✅ Done | Week 8 |
| F-7 | Column sorting in `StreamsTable` (sortField / sortOrder query params) | ✅ Done | Week 9 |
| F-8 | Bulk cancel in `StreamsTable` (`POST /api/streams/bulk-cancel`) | ✅ Done | Week 9 |
| F-9 | Zoom / pan controls in `StreamMetricsChart` (Recharts responsive container) | ✅ Done | Week 9 |
| F-10 | Sender dashboard with per-address filtering and metrics | ✅ Done | Week 8 |
| F-11 | Recipient dashboard with claimable balance and batch claim modal | ✅ Done | Week 9 |
| F-12 | URL-persisted filters and view state (`useUrlFilters`) | ✅ Done | Week 9 |
| F-13 | Draft autosave for stream creation form (`useDraftAutosave`) | ✅ Done | Week 9 |
| F-14 | Offline banner component (`OfflineBanner`) | ✅ Done | Week 10 |
| F-15 | Stream detail drawer (`StreamDetailDrawer`) | ✅ Done | Week 9 |
| F-16 | Event-type filters on `StreamTimeline` | ✅ Done | Week 10 |
| F-17 | Keyboard-accessible modal flow for start-time editing | ✅ Done | Week 10 |
| F-18 | Bulk filter presets for operations teams | ✅ Done | Week 10 |
| F-19 | Stream health badges in `StreamsTable` | ✅ Done | Week 10 |
| F-20 | Freighter wallet connect / disconnect (`useFreighter`, `WalletButton`) | ✅ Done | Week 8 |

---

## Infrastructure

| # | Deliverable | Status | Shipped |
|---|---|---|---|
| X-1 | Docker Compose with hot-reload for backend and frontend | ✅ Done | Week 4 |
| X-2 | Startup environment validation (`validateEnv.ts`) — exits on misconfiguration | ✅ Done | Week 5 |
| X-3 | Swagger / OpenAPI 3.0 auto-generated docs at `/api/docs` | ✅ Done | Week 6 |
| X-4 | Structured JSON request logging middleware (`requestLogger`, `pino`-style) | ✅ Done | Week 6 |
| X-5 | GitHub Actions: `backend-ci.yml` with lint + typecheck + Vitest + 80 % coverage gate | ✅ Done | Week 7 |
| X-6 | GitHub Actions: `contract-ci.yml`, `playwright-e2e.yml`, `codeql.yml`, `gitleaks.yml` | ✅ Done | Week 7 |
| X-7 | PostgreSQL dual-support in `db.ts` via SharedArrayBuffer worker thread | ✅ Done | Week 9 |
| X-8 | SQLite WAL mode + `addColumnIfMissing` incremental migration pattern | ✅ Done | Week 4 |
| X-9 | Contract client auto-generation workflow (`bindings-drift.yml`) | ✅ Done | Week 9 |
| X-10 | WASM size optimization: `opt-level = "z"`, LTO, `wasm-opt -O4` post-build step | ✅ Done | Week 7 |

---

## Summary

| Layer | Planned | Done | In Progress | Planned (not started) |
|---|---|---|---|---|
| Contract | 14 | 14 | 0 | 0 |
| Backend | 29 | 29 | 0 | 0 |
| Frontend | 20 | 20 | 0 | 0 |
| Infra | 10 | 10 | 0 | 0 |
| **Total** | **73** | **73** | **0** | **0** |

Wave 4 is **fully complete**. All deliverables shipped by April 28, 2026 (v1.0.0 release tag).
