# Create Stream Observability & Concurrency Monitoring Signals

**Batch ID**: SSB-2026-094  
**Area**: `backend`  
**Endpoint**: `POST /api/streams`  
**Related Issue**: #1036

This document specifies the structured outcome signals, latency tracking, log correlation, and operator monitoring runbook for the `Create stream endpoint`. It enables operators to observe stream creation flows and distinguish normal idempotent replays from concurrent conflicts (`409 Conflict`) and failures without exposing credentials or wallet secrets.

---

## 1. Outcome Classification & Observability Signals

The `Create stream endpoint` emits structured outcome signals under the `create_stream_signal`, `create_stream_conflict`, and `create_stream_failure` event names:

| Outcome Name | Code | Log Level | `isNormalEmpty` | Description |
|---|---|---|---|---|
| `success` | `0` | `INFO` | `false` | Stream successfully initialized in SQLite and on-chain Soroban escrow. |
| `idempotent_replay` | `1` | `INFO` | `true` | Cached response served for repeat POST after client network timeout. |
| `concurrent_conflict` | `2` | `WARN` | `false` | Two identical creation requests arrived together while first is in-flight (`409 Conflict`). |
| `validation_error` | `3` | `WARN` | `false` | Request payload schema validation failure. |
| `failure` | `4` | `ERROR` | `false` | Unhandled database error or Soroban RPC simulation timeout. |

---

## 2. Emitted Signal Schema & Privacy Guard

The signal payload guarantees zero-secret compliance:
- **No private keys, seed phrases, or JWT bearer tokens are logged.**
- Standard public addresses (`sender`, `recipient`), public IDs (`streamId`), and idempotency keys are exposed for operator tracing.

```json
{
  "event": "create_stream_conflict",
  "outcome": "concurrent_conflict",
  "outcomeCode": 2,
  "detail": "Two identical stream creation requests arrived together.",
  "isNormalEmpty": false,
  "isConcurrentConflict": true,
  "isIdempotentReplay": false,
  "latencyMs": 14,
  "sender": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  "recipient": "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  "idempotencyKey": "key-abc-123",
  "requestId": "req-xyz-456"
}
```

---

## 3. Operator Tracing & Log Correlation

1. **Request Correlation**: Operators can trace stream creations end-to-end using the `requestId` from the `x-request-id` or `x-correlation-id` HTTP request headers.
2. **Idempotency vs Conflict**: In-flight concurrency races emit `concurrent_conflict` with HTTP 409, while retries after completion emit `idempotent_replay` with HTTP 200 and header `X-Idempotent-Replay: true`.
3. **Automated Tests**: Implemented in `backend/src/services/createStreamOutcome.test.ts`.
