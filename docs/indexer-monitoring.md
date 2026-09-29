# Indexer Monitoring

This document describes the observable behaviour of the event indexer's
monitoring signal, how to reproduce each scenario from a clean environment, and
what operator action (if any) each outcome requires.

## Overview

The indexer polls the Stellar RPC node on a configurable interval, reads
contract events, and persists a checkpoint (the last fully-processed ledger
sequence number) to SQLite.  A circuit breaker protects the polling loop from
thrashing against a broken RPC provider.

Two monitoring surfaces expose the indexer's health at runtime:

| Surface | Description |
|---|---|
| `GET /api/indexer/monitoring` | Auth-protected REST endpoint.  Returns `outcome`, `outcomeCode`, `detail`, and the full `state` snapshot. |
| Prometheus scrape (`/metrics`) | `indexer_outcome` gauge (0/1/2), `indexer_circuit_state` gauge (0/1/2), `indexer_ledger_lag` gauge, and supporting counters. |

Both surfaces are derived from `IndexerMonitoringSnapshot` in
`backend/src/services/indexer.ts` and classified by
`classifyIndexerOutcome()` in `backend/src/services/indexerMonitor.ts`.

### Outcome vocabulary

| Outcome | Code | Meaning |
|---|---|---|
| `success` | 0 | Circuit CLOSED, polls completing, no owner action needed. |
| `transient_delay` | 1 | A poll failed but the retry budget is intact, or a half-open recovery probe is in flight.  Self-healing; no owner action needed. |
| `blocked` | 2 | Retry budget exhausted (circuit OPEN) or work outstanding with no RPC configured.  Owner action required. |

---

## Key data types

```typescript
// backend/src/services/indexer.ts
export interface IndexerMonitoringSnapshot {
  rpcConfigured: boolean;          // RPC URL and contract ID both set
  latestLedger: number | null;     // last RPC-observed ledger (null until first success)
  indexedLedger: number;           // persisted checkpoint
  ledgerLag: number;               // max(0, latestLedger - indexedLedger)
  consecutiveFailures: number;     // since last successful poll
  failureThreshold: number;        // 5 — opens circuit when reached
  circuitState: CircuitState;      // CLOSED | HALF_OPEN | OPEN
  lastFailureKind: IndexerRpcFailureKind | null;  // rate_limited | disconnected | provider_error | unknown
  pollInFlight: boolean;
}
```

The snapshot intentionally omits the RPC URL, contract ID, credentials, and raw
provider error messages.  `lastFailureKind` carries only a coarse enum so the
signal is safe to log and scrape.

---

## Scenario A — Lag increasing while RPC is healthy

### What this means

`ledgerLag > 0` with the circuit `CLOSED` and zero consecutive failures means
the indexer is behind the chain tip but RPC is reachable and the polling loop
is working normally.  This is an expected steady-state during catch-up, after a
cold start, or when the polling interval is longer than the ledger close rate.

### Expected outcome

`success` (`outcomeCode: 0`).  Lag alone never produces `transient_delay` or
`blocked`.

### Classification rule (from `classifyIndexerOutcome`)

After all failure/OPEN/HALF_OPEN branches are checked, the final `else` branch
fires:

```
outcome = "success"
detail  = "RPC reached at ledger <N>; the checkpoint is <lag> ledger(s) behind.
           Polls are completing normally and no owner action is required."
```

### How to reproduce from a clean environment

```bash
# From the repo root
cd backend

# 1. Reset to a clean state (no running server needed):
#    The test file does this via resetIndexerState() + fresh in-memory SQLite.

# 2. Run the dedicated monitoring tests:
npx vitest run src/services/indexer.monitoring.test.ts

# The "Scenario A" suite confirms all lag values (0, 1, 10, 100, 10 000)
# produce outcome = "success".
```

No live RPC node, no `.env` file, and no prior local state are required.  The
tests use an in-memory SQLite DB and a mocked `rpc.Server`.

### Metrics to watch

| Metric | Expected value |
|---|---|
| `indexer_outcome` | 0 (success) |
| `indexer_circuit_state` | 0 (CLOSED) |
| `indexer_ledger_lag` | > 0 while catching up, converges to 0 |
| `indexer_errors_total` | stable (no increment during catch-up) |

---

## Scenario B — RPC rate limit or disconnection

### B1. Transient — retry budget intact

A poll fails with a 429 rate-limit or a network error (ECONNREFUSED, timeout,
socket hang up, etc.) but the consecutive-failure count is below the threshold
of 5.  The circuit stays `CLOSED`.

**Expected outcome:** `transient_delay` (`outcomeCode: 1`)

**Detail message example:**

```
1 consecutive poll failure(s) (the provider reported a rate limit); the retry
budget is intact (1/5).  The next scheduled poll retries automatically.
Owner action: none while failures stay below the threshold.
```

**How the failure kind is mapped** (`classifyRpcFailure` in `indexer.ts`):

| Signal | Kind |
|---|---|
| HTTP 429, message contains `rate limit` / `too many requests` / `throttl` | `rate_limited` |
| HTTP 503/504, `ECONNREFUSED`, `ECONNRESET`, `ETIMEDOUT`, `EPIPE`, `socket hang up`, `disconnect`, `network`, `timeout`, `fetch failed` | `disconnected` |
| Other HTTP error with known status code | `provider_error` |
| Everything else | `unknown` |

### B2. Exhausted — circuit open

After 5 consecutive failures the circuit transitions from `CLOSED` to `OPEN`.
While `OPEN`, the `indexEvents()` loop short-circuits immediately — no further
RPC calls are made.  After `CIRCUIT_BREAKER_TIMEOUT_MS` (default: 60 s, set via
env var) the circuit moves to `HALF_OPEN` and allows one probe poll.  A
successful probe closes the circuit; a failed probe reopens it.

**Expected outcome:** `blocked` (`outcomeCode: 2`)

**Detail message example:**

```
RPC polling is blocked: 5 consecutive poll failure(s) reached the 5-failure
threshold and opened the circuit (the provider reported a rate limit).
Owner action: verify RPC availability and provider rate-limit status, restore
network access or reduce competing RPC traffic, and let the scheduled half-open
probe recover the circuit.  Do not restart in a loop.
```

### Circuit breaker state gauge

| `indexer_circuit_state` value | Meaning |
|---|---|
| 0 | CLOSED — normal |
| 1 | HALF_OPEN — recovery probe in flight |
| 2 | OPEN — blocked, owner action needed |

### How to reproduce from a clean environment

```bash
cd backend

# Run the dedicated monitoring tests — no live RPC or .env required:
npx vitest run src/services/indexer.monitoring.test.ts
```

The "Scenario B1" and "Scenario B2" suites exercise:
- Single rate-limited poll → `transient_delay`, circuit stays CLOSED
- Single disconnection poll → `transient_delay`, kind = `disconnected`
- Socket hang-up → `transient_delay`, kind = `disconnected`
- Self-healing: failure then success → `success`, failure counter reset
- 5 consecutive failures → circuit OPEN → `blocked`
- Circuit open for rate-limited failures → `blocked`, detail names rate limit
- Guard: no new RPC calls while circuit is OPEN
- Prometheus gauge updated to `blocked` code
- Raw error messages (including embedded URLs) never appear in snapshot or detail

---

## Configuration reference

| Variable | Default | Constraint | Effect |
|---|---|---|---|
| `INDEXER_POLL_INTERVAL_MS` | 10000 | ≥ 5000 ms | Polling interval passed to `startIndexer()` |
| `CIRCUIT_BREAKER_TIMEOUT_MS` | 60000 | — | Time before OPEN → HALF_OPEN transition |
| `INDEXER_FALLBACK_POLLING_ENABLED` | `false` | — | Switch between cursor-pagination and legacy fallback mode |
| `INDEXER_FALLBACK_POLL_INTERVAL_MS` | 10000 | ≥ 1000 ms | Interval used when fallback mode is active |
| `INDEXER_START_LEDGER` | — | integer | Override checkpoint on startup (useful for re-indexing) |

The circuit-breaker failure threshold (5) and the half-open probe count (1) are
hardcoded in the `CircuitBreaker` constructor in `indexer.ts`.

---

## Files

| File | Role |
|---|---|
| `backend/src/services/indexer.ts` | Polling loop, `CircuitBreaker`, `classifyRpcFailure`, `getIndexerMonitoringSnapshot`, checkpoint persistence |
| `backend/src/services/indexerMonitor.ts` | `classifyIndexerOutcome`, `refreshIndexerMetrics`, outcome types and codes |
| `backend/src/services/metrics.ts` | Prometheus gauge/counter definitions |
| `backend/src/services/indexer.monitoring.test.ts` | Reproducible tests for Scenario A and Scenario B (this document's acceptance criteria) |
| `backend/src/services/indexer.test.ts` | Unit tests: event processing, checkpoint, pagination, fallback, error handling, monitoring snapshot |
| `backend/src/services/indexerMonitor.test.ts` | Unit tests: all outcome classifications, Prometheus publishing, secret safety |
| `backend/src/services/indexer.circuitbreaker.test.ts` | Unit tests: all circuit breaker state transitions |
| `backend/src/services/indexer.gap.test.ts` | Unit tests: gap-fill on restart, cursor persistence, deduplication |

## Validated monitoring thresholds

The following optional settings are validated during startup in `backend/src/config/validateEnv.ts`:

| Setting | Default | Validation | Use |
| --- | ---: | --- | --- |
| `INDEXER_MONITOR_MAX_LEDGER_LAG` | `100` | non-negative integer | Operational threshold for alerting on sustained ledger lag while RPC remains healthy. |
| `INDEXER_MONITOR_MAX_CONSECUTIVE_ERRORS` | `5` | positive integer | Operational threshold aligned with the circuit-breaker failure budget. |

Invalid values fail before the service starts, with the environment variable name and a non-sensitive validation message.
