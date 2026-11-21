# List Streams Results Consistency & Ordering Rule

**Batch ID**: SSB-2026-103  
**Area**: `backend`  
**Endpoint**: `GET /api/streams`  
**Related Issue**: #1045

This document details the consistency rule for total count, deterministic row ordering, committed-state guarantees, and failure isolation for the `List Streams` endpoint.

---

## 1. Consistency Rule Definition

Across database persistence (`streamStore.ts`), sorting helpers (`buildOrderClause`), pagination algorithms, and endpoint handlers (`app.get("/api/streams")`), stream listings adhere to a strict three-part consistency rule:

1. **Deterministic Secondary Tie-Breaker**:
   - Primary ordering follows the caller's requested field and direction (`ORDER BY ${column} ${dir}`).
   - Whenever multiple stream records possess identical values for the primary sort column (e.g., identical `created_at` or `total_amount`), a secondary tie-breaker `, id ASC` is applied.
   - This guarantees stable row sequencing across consecutive pagination windows (`page=1`, `page=2`, etc.) and eliminates record jumping or omission.

2. **Committed-State Guarantee on Success**:
   - Handler responses (`200 OK`) reflect only committed database rows that have successfully written to SQLite.
   - The returned `total` count strictly equals the total count of qualifying committed records, remaining invariant across pagination slices.

3. **No False State Claims on Failure**:
   - In the event of a database read error, lock timeout, or internal exception, the endpoint fails fast with `500 INTERNAL_ERROR` (`Failed to retrieve streams.`).
   - No partial, phantom, or cached intermediate slice is emitted that could misrepresent committed database state.

---

## 2. Acceptance Criteria Verification

- [x] Total count accurately mirrors committed state across all valid query parameters.
- [x] Stable, deterministic row ordering enforced via `, id ASC` secondary tie-breaker in SQL order clauses.
- [x] Zero duplicate or dropped rows between pagination slices.
- [x] Read failures produce explicit HTTP 500 without returning partial/corrupted records.
- [x] Test coverage established in `backend/src/listStreamsConsistency.test.ts`.
