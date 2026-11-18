# List Streams Endpoint Boundary Behavior Specification

**Batch ID**: SSB-2026-101  
**Area**: `backend`  
**Endpoint**: `GET /api/streams`, `GET /api/streams/sender/:address`, `GET /api/streams/recipient/:address`  
**Related Issue**: #1043

This document specifies the boundary behavior, status codes, error payload schemas, and pagination invariants for the `List Streams` API endpoints under extreme boundary inputs and database read failures.

---

## 1. Problem Overview & Scope

The `List Streams` API endpoints expose paginated streams supporting query filters, stable row sorting, and pagination controls (`page` and `limit`).
Under Batch ID `SSB-2026-101`, boundary behavior is formally specified and verified across two operational axes:
1. **Documented Bounds for Pagination (`page` and `limit`)**:
   - `page`: Minimum 1 (1-indexed). Values `< 1` are rejected with deterministic HTTP 400 validation error. Pages beyond total records return HTTP 200 with an empty slice (`data: []`).
   - `limit`: Range `[1, 100]` with default `20`. Values `< 1` or `> 100` are rejected with deterministic HTTP 400 validation errors.
2. **Database Read Failures During Pagination**:
   - Database read timeouts or I/O failures during stream retrieval are safely trapped, emitting failure monitoring signals and returning HTTP 500 `INTERNAL_ERROR` without leaking unhandled exceptions or crashing the server process.

---

## 2. Boundary Behavior Specification Matrix

| Boundary Input / Condition | Validation Rule | HTTP Status | Response Code / Error | Semantics |
|---|---|---|---|---|
| `page=1&limit=1` | Lower bounds for valid pagination | `200 OK` | — | Returns single stream slice; accurate `total`, `page`, and `limit`. |
| `page=1&limit=100` | Upper limit bound | `200 OK` | — | Returns up to 100 streams per page without truncation. |
| `page=0` or `page < 0` | Page boundary violation | `400 Bad Request` | `VALIDATION_ERROR` | Rejects with message `"page must be greater than or equal to 1"`. |
| `limit=0` or `limit < 0` | Limit boundary violation | `400 Bad Request` | `VALIDATION_ERROR` | Rejects with message `"limit must be greater than or equal to 1"`. |
| `limit=101` or `limit > 100` | Limit upper bound violation | `400 Bad Request` | `VALIDATION_ERROR` | Rejects with message `"limit must be less than or equal to 100"`. |
| `page=999` (exceeds total) | Valid page exceeding data length | `200 OK` | — | Returns `data: []` with accurate, invariant `total`. |
| Database Read Failure | DB I/O timeout / query error | `500 Internal Server Error` | `INTERNAL_ERROR` | Returns `"Failed to retrieve streams."` gracefully. |

---

## 3. Total Count and Stable Row Ordering Invariants

1. **Deterministic Order**: Streams are consistently ordered by the requested sort field (`createdAt`, `totalAmount`, etc.) with deterministic ID secondary tie-breakers, guaranteeing stable row order across pagination windows.
2. **Non-overlapping Slices**: Consecutive pages (`page=1, limit=2` and `page=2, limit=2`) form mutually exclusive partitions of the underlying dataset.
3. **Invariant Total Count**: `total` matches the true filtered record count invariant across any requested page index.

---

## 4. Verification and Acceptance Criteria

- [x] Symmetric validation error messages for `page` and `limit` boundary violations.
- [x] Full boundary validation test suite in `backend/src/listStreamsEndpointBoundary.test.ts`.
- [x] Safe database error trapping across list endpoints returning structured HTTP 500.
- [x] Invariant total count and stable row ordering verified across pagination slices.
