# Cancel Stream Endpoint Boundary Behavior

**Batch ID**: SSB-2026-096  
**Area**: `backend`  
**Endpoint**: `POST /api/streams/:id/cancel`  
**Related issue**: #1038

This document defines the boundary behavior of the cancel endpoint for repeated
cancellation of a completed stream and for cancellation racing with a claim. It
complements `docs/cancel-stream-consistency.md` (result consistency),
`docs/cancel-stream-edge-cases.md` (integration edge cases), and
`docs/cancel-stream-monitoring.md` (outcome signals).

---

## 1. Confirmed behavior before the change

The endpoint already returned deterministic status codes:

- a first cancel of a completed stream returned `200` and wrote `canceled_at`
  plus `refunded_amount = 0`, preserving `completed_at`;
- a repeated cancel returned `200` with the committed record unchanged and no
  duplicate `canceled` event;
- a claim that commits during the cancel flow was preserved, and the refund
  followed `total_amount - vested_amount` at the cancel timestamp.

What was missing was an explicit, machine-readable indication of which case the
request hit. Successful and idempotent replays were indistinguishable from a
plain `200` response, so clients had to infer a no-op from the body. This change
keeps the status codes and body identical and adds response headers that state
the committed outcome.

---

## 2. Boundary matrix

| Scenario | HTTP | `X-Cancel-Outcome` | `X-Idempotent-Replay` | State and refund guarantee |
|---|---|---|---|---|
| Cancel an active, scheduled, or paused stream | `200` | `success` | absent | `canceled_at` written, `refunded_amount = max(0, total - vested at cancel)`, one `canceled` event. |
| First cancel of a completed stream (`completed_at` set or duration fully elapsed) | `200` | `already_completed` | absent | `completed_at` retained, `canceled_at` written, `refunded_amount = 0`, one `canceled` event. |
| Claim commits during the cancel flow | `200` | `racing_claim` | absent | Claim events preserved, refund settles against vested value, one `canceled` event. |
| Repeated cancel of an already-canceled stream (including a completed stream) | `200` | `already_canceled` | `true` | No write. `canceled_at`, `completed_at`, `refunded_amount`, and `claimed` totals are unchanged; still exactly one `canceled` event. |
| Stream ID is not a positive integer | `400` | absent | absent | `VALIDATION_ERROR`; no read or write of stream state. |
| Stream does not exist | `404` | absent | absent | `NOT_FOUND`; no state change. |
| Caller is not the sender | `403` | absent | absent | `FORBIDDEN`; no state change. |
| Persistence fails | `500` | absent | absent | Transaction rolls back; no `canceled_at`, refund, event, or webhook. |

`X-Cancel-Outcome-Code` mirrors the header as a stable number:
`success=0`, `already_canceled=1`, `already_completed=2`, `racing_claim=3`,
`failure=4` (failure uses the error response, not the `200` path).

---

## 3. Invariants

1. **Final status never changes silently.** `canceled_at` is terminal and wins
   in `calculateProgress()`. Canceling a completed stream is documented
   behavior and reports `progress.status === "canceled"` while keeping
   `completedAt`; a repeated cancel never rewrites either timestamp.
2. **Refund is computed once.** `refundedAmount` is persisted on the first
   committed cancellation and is never recalculated or overwritten by a replay.
   A settled Soroban cancellation's returned amount remains authoritative.
3. **Claim history is append-only.** Cancellation never modifies or deletes
   `claimed` events, and a claim that lands during the cancel flow is reflected
   by the committed refund and `racing_claim` outcome.
4. **Replays are explicit and side-effect free.** `X-Idempotent-Replay: true`
   is set only when no write committed. Replays emit no webhook and no event.
5. **Existing behavior is preserved.** Status codes, authorization, the `data`
   payload shape, and the completion/refund rules are unchanged for every case
   outside this boundary.

---

## 4. Acceptance criteria verification

- [x] Boundary inputs produce deterministic status codes (`200`, `400`, `403`,
      `404`, `500`) and outcome headers.
- [x] Repeated cancel of a completed stream does not change final status,
      timestamps, refund, or event history.
- [x] Cancel racing with a claim preserves claim history and the settled refund.
- [x] Existing documented behavior outside these cases is unchanged.
- [x] Covered by `backend/src/cancelStreamBoundary.test.ts`,
      `backend/src/services/streamStore.cancel.integration.test.ts`, and the
      outcome-signal tests in `backend/src/services/cancelStreamOutcome.test.ts`.
