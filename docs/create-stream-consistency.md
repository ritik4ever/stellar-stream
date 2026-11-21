# Create Stream Committed-State Consistency Specification

**Batch ID**: SSB-2026-093  
**Area**: `backend`  
**Endpoint**: `POST /api/streams`  
**Related Issue**: #1035

This document defines the committed-state consistency rules for the `Create stream endpoint` under client retries, transient database transaction rollbacks, and concurrent requests.

---

## 1. Consistency Rule Definition

1. **Success State Parity**: On HTTP 201 Created, the returned payload strictly reflects the atomic, committed state written to SQLite/Soroban. The cached response stores only verified, committed records.
2. **Failure Integrity**: When stream creation fails or rolls back, no idempotent response is cached, in-flight locks are immediately released in `finally`, and no mutation is claimed.
3. **Retry Safety**: A client retry after a transient error is never blocked by a poisoned cache or orphaned in-flight lock.

---

## 2. Invariants & Acceptance Verification

- **Atomic Record Consistency**: Exactly one stream record and one creation event exist per committed stream ID.
- **Absence of False Mutation Claims**: Failure responses never claim state changes or poison idempotency keys.
- **Automated Tests**: Implemented in `backend/src/createStreamConsistency.test.ts`.
