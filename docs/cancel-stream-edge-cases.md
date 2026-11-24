# Cancel Stream Endpoint Edge Cases & Concurrency Behavior

**Batch ID**: SSB-2026-100  
**Area**: `backend`  
**Endpoint**: `POST /api/streams/:id/cancel`  
**Related Issue**: #1042

This document details the deterministic behavior and integration guarantees for the `Cancel Stream` endpoint under edge cases involving repeated cancellation on completed streams and concurrent cancellation racing with recipient claims.

---

## 1. Problem Overview & Scope

The cancel stream workflow handles state transitions and fund reclamation. Two critical edge scenarios require deterministic handling:
1. **Repeated cancel on a completed stream**: A stream has already reached its elapsed duration or terminal completed state (`completed_at` is set). A client or automated process issues cancellation, potentially more than once.
2. **Cancel racing with a claim**: A sender cancellation request arrives concurrently with or immediately following a recipient claim transaction.

---

## 2. Behavioral Matrix & Invariants

| Scenario | HTTP Status | Stored Status | Event Emitted | Refund & Balance Semantics |
|---|---|---|---|---|
| **First Cancel on Completed Stream** | `200 OK` | `canceled` (`canceled_at` set) | `canceled` (x1) | `completed_at` is retained, but cancellation is terminal so `progress.status` is `canceled`. `refunded_amount` is persisted as `0` because all value is vested. |
| **Repeated Cancel on Completed Stream** | `200 OK` | `canceled` (`canceled_at` and `refunded_amount` preserved) | *None (0 duplicates)* | Idempotent replay of the committed record. No duplicate database writes or stream history events; the response is identical to a subsequent read. |
| **Cancel Racing with Partial Claim** | `200 OK` | `canceled` | `canceled` (x1) | Claimed totals are derived from `claimed` events and are preserved. `refunded_amount = total_amount - vested_amount at the cancel timestamp`, matching the contract's `settle_cancel` rule — not `total_amount - claimed_amount`, because value that vested after the claim still belongs to the recipient. |
| **Repeated Cancel after Claim** | `200 OK` | `canceled` | *None (0 duplicates)* | Idempotent. `canceled_at`, `refunded_amount`, and claimed history are unchanged. |

### Final status and refund rule

1. **Terminal status**: `canceled_at` wins over every other status. A canceled stream can never revert to `active`/`completed`, and `completed_at` is retained for auditing.
2. **Refund**: the contract settles `total_amount - vested_amount(now)` back to the sender. The API persists and returns the same value (`refunded_amount`) when it commits a cancellation. When a Soroban cancellation actually settles, its return value is authoritative.
3. **Claims**: the claimed total is the sum of `claimed` events (`getClaimedTotal`), not a column on `streams`. Cancellation never rewrites claim history.
4. **Committed results only**: the mutation service reports whether it actually wrote `canceled_at`. The handler classifies the outcome (`success`, `racing_claim`, `already_completed`, `already_canceled`) from that committed state, so a lost race or a retry is never reported as a new change. On error the transaction rolls back and the endpoint returns an error with no committed cancellation or refund.

---

## 3. Acceptance Criteria Verification

- [x] **Deterministic Status Codes**: All valid repeated cancel and race scenarios return HTTP 200 with accurate progress status.
- [x] **Absence of Duplicate Side Effects**: Event history records exactly 1 `canceled` event regardless of retry frequency.
- [x] **Accurate Refund Calculation**: `refunded_amount` follows the contract rule and partitions the stream total with the vested amount; concurrent claims are preserved without double-counting.
- [x] **Committed Results**: The response equals the next read of the committed record, and no state changes when the request fails.
- [x] **Automated Integration Coverage**: Covered in `backend/src/services/streamStore.cancel.integration.test.ts`.
