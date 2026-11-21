# List Streams Observability & Pagination Monitoring Signals

**Batch ID**: SSB-2026-104  
**Area**: `backend`  
**Endpoint**: `GET /api/streams`  
**Related Issue**: #1046

This document describes the structured telemetry, outcome codes, latency measurements, and runbook procedures for the `List Streams` endpoint, enabling operators to observe pagination queries and distinguish normal empty results from database read failures without exposing credentials or wallet secrets.

---

## 1. Outcome Classification & Observability Signals

The `List Streams` endpoint emits structured signals with every query execution:

| Outcome | Numeric Code | Normal Empty (`isNormalEmpty`) | Description | Log Level |
|---|---|---|---|---|
| **`success` (Populated)** | `0` | `false` | Streams query succeeded; one or more stream records returned. | `INFO` |
| **`success` (Normal Empty)** | `0` | `true` | Valid query returned 0 records (e.g., filters matched no rows or store is clean). | `INFO` |
| **`failure`** | `2` | `false` | Database read failure or SQLite I/O error occurred during pagination. | `ERROR` |

---

## 2. Distinguishing Normal Empty Results from Failures

Alerting rules and automated monitoring can evaluate `isNormalEmpty` and `outcomeCode`:

- **Normal Empty Results (`isNormalEmpty: true`)**:
  - `outcome`: `"success"` (`outcomeCode: 0`)
  - `total`: `0`
  - Detail: *"Normal empty stream list query."*
  - Requires **no operator intervention**.
- **Database Read Failure (`isNormalEmpty: false`)**:
  - `outcome`: `"failure"` (`outcomeCode: 2`)
  - `detail`: *"Database read failure during pagination."*
  - Triggers error log with `requestId` or `correlationId`. Operator alert for database health inspection.

---

## 3. Secret-Free Logging Guarantee

All emitted signals are processed through the core redaction pipeline:
- No Stellar private keys (`S...`), seeds, or authorization bearer tokens are captured or logged.
- Only correlation identifiers (`x-request-id`, `x-correlation-id`), pagination bounds (`page`, `limit`), row counts (`total`, `returnedCount`), and execution latency (`latencyMs`) are recorded.

---

## 4. Acceptance Criteria Verification

- [x] Operators can distinguish normal empty queries from database read failures via `isNormalEmpty` and numeric outcome codes.
- [x] Structured logs correlate with request identifiers (`X-Request-ID`).
- [x] Zero credential or wallet secret leakage.
- [x] Automated test coverage verified in `backend/src/services/listStreamsOutcome.test.ts`.
