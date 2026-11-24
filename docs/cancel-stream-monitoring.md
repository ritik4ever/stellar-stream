# Cancel Stream Observability & Outcome Monitoring Signals

**Batch ID**: SSB-2026-099  
**Area**: `backend`  
**Endpoint**: `POST /api/streams/:id/cancel`  
**Related Issue**: #1041

This document specifies the structured outcome signals, latency tracking, log correlation, and operator monitoring runbook for the `Cancel stream endpoint`. It enables operators to observe cancellation flows and distinguish normal idempotent cancellations from failures, repeated cancels on completed streams, and cancels racing with claims without exposing credentials or wallet secrets.

---

## 1. Outcome Classification & Observability Signals

The `Cancel stream endpoint` emits structured outcome signals under the `cancel_stream_signal` and `cancel_stream_failure` event names:

| Outcome Name | Code | Log Level | `isNormalEmpty` | Description |
|---|---|---|---|---|
| `success` | `0` | `INFO` | `false` | Stream successfully canceled and remaining unvested funds refunded. |
| `already_canceled` | `1` | `INFO` | `true` | Idempotent repeat cancel on a stream that was already canceled. |
| `already_completed` | `2` | `INFO` | `true` | Cancellation requested on an already fully vested / completed stream. |
| `racing_claim` | `3` | `INFO` | `false` | Cancellation succeeded concurrently while a recipient claim was processed. |
| `failure` | `4` | `ERROR` | `false` | Unhandled database deadlock or chain contract simulation failure. |

---

## 2. Emitted Signal Schema & Privacy Guard

The signal payload guarantees strict zero-secret compliance:
- **No private keys, seed phrases, or JWT bearer tokens are ever included.**
- Standard public addresses (`sender`, `recipient`) and public IDs (`streamId`, `requestId`) are exposed for operator tracing.

```json
{
  "event": "cancel_stream_signal",
  "outcome": "racing_claim",
  "outcomeCode": 3,
  "detail": "Cancel succeeded with racing claim settlement.",
  "isNormalEmpty": false,
  "isRacingClaim": true,
  "isRepeatedCancel": false,
  "latencyMs": 42,
  "streamId": "stream-12345",
  "sender": "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF",
  "recipient": "GBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBBB",
  "canceledAt": 1700002000,
  "requestId": "req-98765"
}
```

---

## 3. Operator Tracing & Log Correlation

1. **Request Correlation**: Operators can trace cancellations end-to-end using the `requestId` from the `x-request-id` or `x-correlation-id` HTTP request headers.
2. **Stream Lifecycle Correlation**: All signals include `streamId` allowing operators to cross-reference with event history and stream audit trails.
3. **Idempotency vs Failure**: Cancellations of completed streams and repeated cancellations of already-canceled streams set `isNormalEmpty: true`. Only a request whose committed record was already canceled sets `isRepeatedCancel: true`; the first cancel of a completed stream reports `already_completed` with `isRepeatedCancel: false`. Both prevent false-positive alert pages on routine user retries.

---

## 4. Verification and Acceptance Criteria

- [x] Structured outcome and latency signals emitted for all cancel states (`success`, `already_canceled`, `already_completed`, `racing_claim`, `failure`).
- [x] Zero secret or wallet credential exposure guaranteed in logs.
- [x] End-to-end unit and integration test suite implemented in `backend/src/services/cancelStreamOutcome.test.ts`.
- [x] Full backward compatibility preserved for existing callers.
