# List Streams Endpoint Boundary Behavior & Pagination Recovery

**Batch ID**: SSB-2026-105  
**Area**: `backend`  
**Endpoint**: `GET /api/streams`  
**Related Issue**: #1047

This document defines the boundary behavior, status codes, and error recovery semantics for the `List Streams` endpoint when handling edge pagination parameters and database read failures.

---

## 1. Problem Overview & Scope

The `List Streams` endpoint supports query filtering and paginated exploration of payment streams. Two critical operational areas require deterministic boundary validation:
1. **Documented Bounds for Pagination (`page` and `limit`)**: Validation against documented min/max limits (minimum page 1, limit range 1 to 100), as well as out-of-range pages beyond available total records.
2. **Database Read Failures During Pagination**: Handling transient database disconnects or disk I/O errors during collection reads safely, preventing uncaught exceptions and ensuring deterministic operator responses.

---

## 2. Boundary Input Behavior Matrix

| Boundary Scenario | Detection Condition | HTTP Status | Error / Code | Operator Semantics |
|---|---|---|---|---|
| **Valid Minimal Bounds** | `page=1&limit=1` | `200 OK` | — | Returns single stream slice; accurate `total`, `page`, and `limit`. |
| **Valid Maximum Limit** | `page=1&limit=100` | `200 OK` | — | Returns up to 100 streams per page without truncation errors. |
| **Below Minimum Page** | `page=0` or `page < 0` | `400 Bad Request` | `VALIDATION_ERROR` | Rejects invalid page with explicit requirement message (`page must be greater than or equal to 1`). |
| **Below Minimum Limit** | `limit=0` or `limit < 0` | `400 Bad Request` | `VALIDATION_ERROR` | Rejects non-positive limit. |
| **Above Maximum Limit** | `limit=101` or `limit > 100` | `400 Bad Request` | `VALIDATION_ERROR` | Enforces upper bound limit (`limit must be less than or equal to 100`). |
| **Page Beyond Total Records** | `page=999` with total=5 | `200 OK` | — | Deterministic response with empty `data: []` and correct `total`. |
| **Database Read Failure** | DB query throws I/O exception | `500 Internal Server Error` | `INTERNAL_ERROR` | Returns structured error payload (`Failed to retrieve streams.`), preventing server crash. |

---

## 3. Row Ordering and Total Count Invariants

- **Stable Sequence**: Records maintain deterministic sort order (by default `createdAt desc`, or specified `sort` and `order`).
- **Zero Inter-page Overlap**: Slices across consecutive pages (`page=1` then `page=2`) are mutually exclusive and partition the dataset completely.
- **Accurate Invariant Total**: Total count reflects matching records consistently across all valid pagination queries.

---

## 4. Acceptance Criteria Verification

- [x] Documented pagination bounds verified via unit and boundary integration tests.
- [x] Database read errors during stream retrieval are safely trapped and mapped to HTTP 500 `INTERNAL_ERROR`.
- [x] Invariant total count and stable row ordering preserved across slices.
- [x] Full integration test suite provided in `backend/src/listStreamsBoundary.test.ts`.
