# Cancel Stream Endpoint Result Consistency

**Batch ID**: SSB-2026-098
**Area**: `backend`
**Endpoint**: `POST /api/streams/:id/cancel`
**Related Issue**: #1040

This document defines how the cancel endpoint's HTTP result, stored stream,
event history, and refund stay consistent, including repeated cancellation of a
completed stream and cancellation racing with a claim.

---

## 1. Confirmed behavior before the change

- The handler inferred "already canceled" and "already completed" from a
  snapshot read *before* the mutation. A concurrent cancel that won the race
  could therefore be reported as a `success` change for the losing request.
- Racing-claim detection read `stream.claimedAmount`, but `streams` has no
  `claimed_amount` column and `StreamRecord` has no such field. The branch was
  unreachable in production; claimed totals live in `stream_events`.
- `refunded_amount` was only stored when a Soroban cancellation returned a
  value. Local (contract-disabled) cancellations returned no refund at all,
  so the response differed between deployments.
- `docs/cancel-stream-edge-cases.md` described the racing refund as
  `total_amount - claimed_amount`, which does not match the contract's
  `settle_cancel` (`total_amount - vested_amount at cancel time`).

---

## 2. Consistency rule

1. **Committed state is the only source of truth.** The response `data` is the
   record read back after the write. The next `GET /api/streams/:id` returns
   the same `canceledAt`, `refundedAmount`, and `progress`.
2. **A change is only claimed when a write committed.** `cancelStream()` returns
   `{ stream, changed, wasAlreadyCanceled, wasCompleted, claimedAmountBefore,
   claimedAmountAfter }`. The handler derives its outcome signal from this
   result, not from a pre-request snapshot, using this precedence:
   1. no write because the record was already canceled → `already_canceled`
   2. a claim committed during the cancel flow (claimed total advanced) → `racing_claim`
   3. the stream was already final at commit → `already_completed`
   4. otherwise → `success`
3. **Final status.** `canceled_at` is terminal and takes precedence in
   `calculateProgress()`. Canceling a completed stream preserves
   `completed_at` and reports `progress.status === "canceled"` (documented
   behavior preserved); repeated cancels return the same record unchanged.
4. **Refund.** `refunded_amount = max(0, total_amount - vested_amount at the
   cancel timestamp)`, persisted on the first cancellation. A value returned by
   a settled Soroban cancellation is authoritative. Replays never overwrite it.
   For a newly canceled stream with no on-chain value,
   `refundedAmount + progress.vestedAmount === totalAmount`.
5. **Claims.** Claimed totals are the sum of `claimed` events
   (`getClaimedTotal`). Cancellation does not modify them, and a claim that
   commits during the cancel flow is detected by comparing the totals before
   and at commit.
6. **Failure is atomic.** If the stream/event write fails, the SQLite
   transaction rolls back, no `canceled_at` or `refunded_amount` is stored, no
   webhook is triggered, and the endpoint returns a 500 error.

---

## 3. Implementation map

| Layer | File | Responsibility |
|---|---|---|
| Handler | `backend/src/index.ts` | Authorization, conversion of committed result → outcome signal, committed-state response |
| Service | `backend/src/services/streamStore.ts` | Atomic cancellation, completion/claim classification, refund persistence |
| Event log | `backend/src/services/eventHistory.ts` | `getClaimedTotal()` used for claim detection |
| Docs | `backend/src/swagger.ts`, `docs/cancel-stream-edge-cases.md` | Endpoint and edge-case contract |

---

## 4. Verification

Covered by `backend/src/services/streamStore.cancel.integration.test.ts`:

- mutation response matches a subsequent read of the committed record;
- duplicate concurrent cancels commit exactly one cancellation and one event;
- repeated cancel on a completed stream preserves timestamps and a `0` refund;
- a fully claimed stream is treated as completed and refunds nothing;
- a cancel racing with a claim preserves claim events and settles the contract
  refund formula;
- a forced event-write failure leaves `canceled_at`/`refunded_amount` null and
  returns a 500 error.
