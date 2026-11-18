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
| **First Cancel on Completed Stream** | `200 OK` | `canceled` (`canceled_at` set) | `canceled` (x1) | Stream marked canceled; completed timestamp retained. Refund is 0 as all funds are fully streamed. |
| **Repeated Cancel on Completed Stream** | `200 OK` | `canceled` (`canceled_at` preserved) | *None (0 duplicates)* | Idempotent replay of existing record. No duplicate database side effects or stream history events. |
| **Cancel Racing with Partial Claim** | `200 OK` | `canceled` | `canceled` (x1) | Previously claimed amount (`claimed_amount`) is preserved. Refundable remainder equals `total_amount - claimed_amount`. |
| **Repeated Cancel after Claim** | `200 OK` | `canceled` | *None (0 duplicates)* | Idempotent. Status and remaining balance unchanged. |

---

## 3. Acceptance Criteria Verification

- [x] **Deterministic Status Codes**: All valid repeated cancel and race scenarios return HTTP 200 with accurate progress status.
- [x] **Absence of Duplicate Side Effects**: Event history records exactly 1 `canceled` event regardless of retry frequency.
- [x] **Accurate Refund Calculation**: Refundable balance reflects unstreamed/unclaimed remainder without double-counting.
- [x] **Automated Integration Coverage**: Covered in `backend/src/services/streamStore.cancel.integration.test.ts`.
