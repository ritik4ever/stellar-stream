# Reconciliation Worker Observability Signals

**Batch ID**: SSB-2026-139  
**Area**: `backend`  
**Components**: `backend/src/services/reconciliationJob.ts`, `backend/src/services/streamStore.ts`  
**Related Issue**: #1082

This document specifies the structured outcome and latency signals emitted by the reconciliation worker, including RPC outages during reconciliation and local state repairs from confirmed on-chain events.

## 1. Outcome Classification

| Outcome | Code | Log Level | `isNormalEmpty` | Meaning |
|---|---:|---|---|---|
| `success` | `0` | `INFO` | `true` | Normal empty reconciliation: no on-chain streams, no missing local streams, or Soroban intentionally not configured. No owner action. |
| `success` | `0` | `INFO` | `false` | Reconciliation repaired missing local streams or synchronized one stream with confirmed on-chain state without duplicate rows/events. |
| `rpc_outage` | `1` | `ERROR` | `false` | RPC was unavailable while reading the next stream ID, backfilling a missing stream, or reconciling one stream against chain state. Already committed streams are preserved; the next cycle retries. |
| `failure` | `2` | `ERROR` | `false` | Non-RPC validation, configuration, or commit failure. Owner action is required. |

Numeric codes are stable; dashboards and alerts must key off `outcomeCode`.

## 2. Signal Schema

Structured logs use one of `reconciliation_success`, `reconciliation_rpc_outage`, or `reconciliation_failure`:

```json
{
  "event": "reconciliation_rpc_outage",
  "outcome": "rpc_outage",
  "outcomeCode": 1,
  "detail": "Reconciliation RPC outage while backfilling stream 2 (the RPC connection failed). The worker stopped early after committing 1 stream(s); 2 remain for the next cycle. Owner action: verify RPC availability and provider rate-limit status. Do not restart in a loop.",
  "isNormalEmpty": false,
  "latencyMs": 2034,
  "stage": "stream_backfill",
  "repairedCount": 1,
  "missingCount": 3,
  "errorKind": "connection",
  "streamId": "2",
  "correlationId": "reconciliation-2f8c...",
  "correlation_id": "reconciliation-2f8c..."
}
```

Additional fields:

- `stage`: `not_configured`, `validation`, `next_stream_id`, `missing_streams`, `stream_backfill`, or `stream_reconcile`.
- `requestId`: present for `POST /api/streams/:id/reconcile` requests, sourced from `X-Request-ID` / `X-Correlation-ID`.
- `correlationId`: generated per worker cycle and injected into all logs in that cycle; request-supplied when reconciling from the API.
- `streamId`: present for per-stream reconciliation and backfill outages.
- `errorKind`: one of `timeout`, `connection`, `rate_limited`, `provider_error`, or `unexpected`.

## 3. Secret-Free Guarantee

Signals and their log payloads carry only enumerated state, counts, latency, and public stream/request identifiers. Raw provider errors, RPC URLs, embedded credentials, wallet secrets, and private keys are never included. Error messages are classified into `errorKind` before emission, and the shared pino redaction pipeline remains in place.

## 4. Operator Tracing

1. **Worker cycles**: filter logs by `correlation_id` (for example `reconciliation-…`) to follow one cycle from missing-stream detection through the outcome signal.
2. **API-driven reconciliation**: use `requestId` from the reconcile request headers together with `streamId`.
3. **Normal empty vs failure**: `outcome: "success"` with `isNormalEmpty: true` requires no action; `rpc_outage` or `failure` with `isNormalEmpty: false` is actionable.

Prometheus exposes `reconciliation_outcome`, `reconciliation_latency_ms`, and `reconciliation_rpc_outages_total` for alerting. Alert when `reconciliation_outcome != 0` or when the RPC outage counter rises repeatedly.

## 5. Acceptance Criteria

- [x] Operators distinguish normal empty reconciliation from RPC outage and failure via `outcome`, `outcomeCode`, and `isNormalEmpty`.
- [x] Logs are linkable with a cycle correlation ID, request ID, or stream ID.
- [x] Structured outcome and latency signals are emitted for RPC outages during reconciliation.
- [x] No wallet secrets, private keys, RPC URLs, or full credentials are logged.
- [x] Existing reconciliation return values, retry behavior, transaction rollback, and early-break recovery are preserved.
- [x] Tests: `backend/src/services/reconciliationOutcome.test.ts`, `backend/src/services/streamStore.reconcile.test.ts`, `backend/src/services/reconciliationJob.test.ts`.
