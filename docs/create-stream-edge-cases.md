# Create Stream Endpoint Concurrency & Timeout Edge Cases Specification

**Batch ID**: SSB-2026-095  
**Area**: `backend`  
**Endpoint**: `POST /api/streams`  
**Related Issue**: #1037

This document defines the edge case handling and test specifications for the `Create stream endpoint` under network timeout replays and simultaneous identical request concurrency.

---

## 1. Problem & Scope

Under Batch ID `SSB-2026-095`, the Create stream endpoint enforces atomic idempotency and concurrency guards:
1. **Repeat POST after a client timeout**: When a client dispatches a stream creation request, experiences a network timeout or dropped connection, and retries with the same `Idempotency-Key` (or parameter fingerprint), the system returns the committed stream with HTTP `200 OK` and header `X-Idempotent-Replay: true`. No duplicate database records, money-moving transactions, or creation events are created.
2. **Two identical requests arriving together**: When two simultaneous requests arrive with identical idempotency keys or parameter fingerprints, the second request is immediately rejected with HTTP `409 Conflict` (`CONFLICT`).

---

## 2. Invariants & Acceptance Verification

- **Atomic Record Count**: Exactly one stream record and one creation history event are persisted in the database.
- **Zero Duplicate Side Effects**: On-chain escrow creation and database insertions execute exactly once.
- **Deterministic Status**: HTTP 201 on first arrival, HTTP 200 with replay header on retry, and HTTP 409 on concurrent collision.
- **Automated Tests**: Implemented in `backend/src/createStreamEdgeCases.test.ts`.
