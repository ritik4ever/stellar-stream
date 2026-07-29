# Wave 5 — StellarStream Deliverables

Wave 5 focuses on **security hardening, observability, developer experience, and frontend polish** —
building directly on the production foundation laid in Wave 4. Work is ongoing as of the v1.0.0 release
baseline (April 28, 2026).

## Themes

| Theme | Scope |
|---|---|
| **Security** | Input sanitisation · auth hardening · header hygiene · payload limits |
| **Observability** | Time-series metrics · structured logging · alerting hooks · extended health check |
| **Backend** | Missing endpoints · caching improvements · reconciliation · graceful shutdown |
| **Frontend** | Metrics visualisation · accessibility · error boundaries · UX polish |
| **Testing** | Coverage gaps · integration tests · property-based tests · CI gates |
| **Infra** | Coverage enforcement · Docker hardening · deployment documentation |

## Timeline

> Wave 5 target window: **May 2026 → July 2026** (≈ 10 weeks).
> Weeks 1-3: security and observability foundations.
> Weeks 4-6: backend completions and frontend wiring.
> Weeks 7-9: testing and CI gates.
> Week 10: documentation and infra polish.

---

## Security

| # | Deliverable | Status | Week Target |
|---|---|---|---|
| S-1 | Request body size limit (`express.json({ limit: '32kb' })`) with 413 / 400 error responses | ✅ Done | — |
| S-2 | Sanitise string inputs (strip null bytes and control characters) in Zod schemas | 🔲 Planned | Week 1 |
| S-3 | `helmet` middleware for security headers (CSP, HSTS, X-Frame-Options) | ✅ Done | — |
| S-4 | Enforce `Content-Type: application/json` on all mutation endpoints | ✅ Done | — |
| S-5 | CORS origin allowlist via `ALLOWED_ORIGINS` env var (replace open `cors()`) | ✅ Done | — |
| S-6 | JWT `aud` and `iss` claim validation in `authMiddleware` | 🔲 Planned | Week 2 |
| S-7 | Rotate JWT secret without downtime (dual-secret grace period) | 🔲 Planned | Week 3 |
| S-8 | Admin endpoint authentication audit — ensure all `adminAuth` routes have test coverage | 🔲 Planned | Week 2 |

---

## Observability

| # | Deliverable | Status | Week Target |
|---|---|---|---|
| O-1 | `GET /api/metrics/history?days=N` — daily aggregate time-series (max 90 days, 5-min TTL cache) | ✅ Done | — |
| O-2 | Wire `GET /api/stats` route to `getStreamStats()` from `stats.ts` | ✅ Done | — |
| O-3 | `collectDefaultMetrics()` added to Prometheus registry in `metrics.ts` | 🔲 Planned | Week 1 |
| O-4 | Structured JSON logging (`pino`-based logger replaces `console.log`) | ✅ Done | — |
| O-5 | Log request duration in `requestLogger` middleware | ✅ Done | — |
| O-6 | Cache hit / miss counters exposed as Prometheus metrics | 🔲 Planned | Week 2 |
| O-7 | Alert threshold config for indexer lag (ledger sequence delta exceeds configurable limit) | 🔲 Planned | Week 3 |
| O-8 | Health endpoint extended: include DB status, indexer lag, and cache connectivity | 🔲 Planned | Week 2 |

---

## Backend

| # | Deliverable | Status | Week Target |
|---|---|---|---|
| K-1 | `GET /api/streams/:id/progress` — real-time vesting progress snapshot | 🔲 Planned | Week 4 |
| K-2 | `GET /api/streams/stats/summary` — aggregate counts by status | 🔲 Planned | Week 4 |
| K-3 | Cursor-based pagination on `GET /api/events` (replace offset pagination for large datasets) | 🔲 Planned | Week 5 |
| K-4 | Configurable reconciliation interval via env var (`RECONCILIATION_INTERVAL_MS`) | 🔵 In Progress | Week 4 |
| K-5 | Reconciliation job: emit Prometheus metrics on drift count and correction count | 🔲 Planned | Week 5 |
| K-6 | `streamStore.ts`: composite indexes on `streams(sender)` and `streams(recipient)` | 🔲 Planned | Week 4 |
| K-7 | Cache `listStreams` results with short TTL, invalidated on mutation | 🔲 Planned | Week 5 |
| K-8 | Graceful shutdown: drain in-flight requests before `process.exit` | 🔲 Planned | Week 6 |
| K-9 | `POST /api/streams/:id/archive` — explicit admin archive endpoint (complement to background job) | 🔲 Planned | Week 5 |
| K-10 | Validate `ALLOWED_ASSETS` env var on startup (non-empty, valid asset codes) | 🔲 Planned | Week 3 |

---

## Frontend

| # | Deliverable | Status | Week Target |
|---|---|---|---|
| UI-1 | Connect `useMetricsHistory` hook to live `GET /api/metrics/history` endpoint | 🔵 In Progress | Week 4 |
| UI-2 | `StreamMetricsChart`: render daily `activeStreams` and `totalVested` as dual-axis line chart | 🔵 In Progress | Week 5 |
| UI-3 | `StatsPanel`: display live aggregate stats from `GET /api/stats` | 🔵 In Progress | Week 5 |
| UI-4 | Global `ErrorBoundary` component wrapping the app root | 🔲 Planned | Week 4 |
| UI-5 | Retry button in error states (streams list, metrics chart) | 🔲 Planned | Week 5 |
| UI-6 | Skeleton loaders for `StreamsTable` and `StatsPanel` during initial fetch | 🔲 Planned | Week 5 |
| UI-7 | Accessible colour contrast audit (WCAG AA) on dark mode palette | 🔲 Planned | Week 7 |
| UI-8 | Keyboard navigation for `StreamsTable` row actions (cancel, pause, resume) | 🔲 Planned | Week 7 |
| UI-9 | `aria-live` region for toast notifications | 🔲 Planned | Week 7 |
| UI-10 | Persist selected asset filter in URL query params (`?asset=USDC`) | ✅ Done | — |
| UI-11 | Export button: trigger CSV download from `GET /api/streams/export.csv` | 🔲 Planned | Week 6 |
| UI-12 | Stream detail page: show event history timeline using `GET /api/streams/:id/history` | 🔵 In Progress | Week 6 |

---

## Testing

| # | Deliverable | Status | Week Target |
|---|---|---|---|
| T-1 | Backend: integration test for 413 response on oversized JSON body | 🔲 Planned | Week 7 |
| T-2 | Backend: integration test for 400 response on malformed JSON body | 🔲 Planned | Week 7 |
| T-3 | Backend: unit tests for `getMetricsHistory` with mocked DB | 🔲 Planned | Week 7 |
| T-4 | Backend: unit tests for `getStreamStats` cache invalidation | 🔲 Planned | Week 7 |
| T-5 | Backend: property-based tests for pagination (arbitrary page / limit combos) | 🔲 Planned | Week 8 |
| T-6 | Frontend: test `useMetricsHistory` hook with MSW mock for `/api/metrics/history` | 🔲 Planned | Week 8 |
| T-7 | Frontend: test `StreamMetricsChart` renders the correct number of data points | 🔲 Planned | Week 8 |
| T-8 | Frontend: test `ErrorBoundary` catches render errors and shows fallback UI | 🔲 Planned | Week 8 |
| T-9 | CI: enforce minimum 70 % line coverage gate on backend (`--coverage.thresholds.lines=70`) | 🔲 Planned | Week 9 |
| T-10 | CI: enforce minimum 60 % line coverage gate on frontend | 🔲 Planned | Week 9 |

---

## Infrastructure

| # | Deliverable | Status | Week Target |
|---|---|---|---|
| N-1 | Add `@vitest/coverage-v8` coverage step to `backend-ci.yml` | 🔲 Planned | Week 9 |
| N-2 | Add coverage step to `frontend-ci.yml` | 🔲 Planned | Week 9 |
| N-3 | Upload coverage reports to Codecov (or equivalent) from CI | 🔲 Planned | Week 9 |
| N-4 | Docker: add `HEALTHCHECK` instruction to backend `dockerfile` | 🔲 Planned | Week 6 |
| N-5 | Docker: run backend container as non-root user | 🔲 Planned | Week 6 |
| N-6 | `DEPLOYMENT.md`: document `REDIS_URL` env var and cache behaviour | 🔲 Planned | Week 10 |
| N-7 | `DEPLOYMENT.md`: document `METRICS_AUTH` env var for Prometheus scrape auth | 🔲 Planned | Week 10 |
| N-8 | Dependabot config for automated dependency updates | ✅ Done | — |

---

## Summary

| Theme | Total | ✅ Done | 🔵 In Progress | 🔲 Planned |
|---|---|---|---|---|
| Security | 8 | 4 | 0 | 4 |
| Observability | 8 | 4 | 0 | 4 |
| Backend | 10 | 0 | 1 | 9 |
| Frontend | 12 | 1 | 4 | 7 |
| Testing | 10 | 0 | 0 | 10 |
| Infra | 8 | 1 | 0 | 7 |
| **Total** | **56** | **10** | **5** | **41** |

### Status Key

| Marker | Meaning |
|---|---|
| ✅ Done | Implemented and merged — confirmed by source code inspection |
| 🔵 In Progress | Service / component exists with partial wiring; endpoint or UI integration incomplete |
| 🔲 Planned | Not yet started; inferred from codebase gaps and the original Wave 5 issue backlog |
