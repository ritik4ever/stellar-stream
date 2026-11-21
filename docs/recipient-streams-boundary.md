# Recipient Streams Endpoint Boundary Behavior & Timeout Recovery

**Batch IDs**: SSB-2026-111, SSB-2026-115  
**Area**: `backend`

This document defines the boundary behavior, status codes, and recovery semantics for the Recipient Streams endpoints:
- `GET /api/recipients/:accountId/streams`
- `GET /api/streams/recipient/:address`

---

## 1. Boundary Input Behavior Matrix

The recipient streams endpoints evaluate path and query parameters against strict boundary rules to guarantee deterministic HTTP responses and prevent silent alteration of recipient-scoped results:

| Input Condition | Boundary Criteria | HTTP Status | Response Code | Semantics & Operator Impact |
|---|---|---|---|---|
| **Invalid Checksum** | 56 characters, starts with `G`, valid base32 characters, but corrupted Ed25519 StrKey checksum | `400 Bad Request` | `VALIDATION_ERROR` | Fails input validation before executing any database queries or cache reads. Returns field error `accountId: must be a valid Stellar account ID`. |
| **Malformed Address Length** | Length $\neq 56$ characters (e.g., 55 or 57 characters) | `400 Bad Request` | `VALIDATION_ERROR` | Fails before query execution. Returns deterministic 400 error. |
| **Malformed Address Prefix** | Account ID starting with any character other than `G` (e.g., `S...`, `C...`, `M...`) | `400 Bad Request` | `VALIDATION_ERROR` | Rejected immediately. Prevents accidental exposure or leakage of Stellar secret seeds (`S...`). |
| **Valid Empty Account** | Valid Ed25519 public key with valid checksum, but 0 streams exist in store | `200 OK` | N/A (success) | Returns `{ data: [], total: 0, page: 1, limit: 0 }`. Distinguishable from validation failure; does not return 404 or throw 500, and preserves stored streams for other recipients. |
| **Valid Recipient with Streams** | Valid Ed25519 public key with one or more streams in store | `200 OK` | N/A (success) | Returns matching streams with live computed progress (`vestedAmount`, `remainingAmount`, `status`). |
| **Conflicting Query Filter** | Query parameter `?recipient=G...` provided alongside path `:accountId` | `200 OK` (filtered) | N/A (success) | Filtered deterministically by `query.recipient`. If the query parameter does not match the path account ID, returns empty list `[]` rather than silently returning another account's streams. |
| **Transient DB Timeout** | Database query encounters transient lock or timeout (`SQLITE_BUSY`, `SQLITE_LOCKED`, `ETIMEDOUT`, `QUERY_TIMEOUT`, `57014`) | `200 OK` | N/A (success) | Read-only retry automatically recovers and succeeds without duplicating any events, RPC calls, or state. |
| **Persistent DB Timeout** | Database query encounters persistent timeout across retries | `503 Service Unavailable` | `DATABASE_TIMEOUT` | Returns explicit error: `"Database query timed out while fetching recipient streams."`. Zero state mutations and failed responses are never cached. |

---

## 2. Distinguishing Validation Errors from Empty Account States

A key requirement of SSB-2026-111 and SSB-2026-115 is ensuring that clients and automated integrations can cleanly differentiate between invalid account identifiers and legitimate accounts that have not yet received any stream allocations:

- **Invalid Account Checksum (400)**:
  ```json
  {
    "error": "accountId: must be a valid Stellar account ID",
    "statusCode": 400,
    "code": "VALIDATION_ERROR",
    "details": [
      {
        "field": "accountId",
        "message": "must be a valid Stellar account ID"
      }
    ]
  }
  ```

- **Valid Empty Account (200)**:
  ```json
  {
    "data": [],
    "total": 0,
    "page": 1,
    "limit": 0
  }
  ```

---

## 3. Database Query Timeout Recovery Semantics

Fetching recipient streams is an idempotent, read-only operation:
1. `queryRecipientStreamsWithRetry(recipientAddress, sort, order)` catches `SQLITE_BUSY`, `SQLITE_LOCKED`, `ETIMEDOUT`, `QUERY_TIMEOUT`, `DATABASE_TIMEOUT`, `57014` (PostgreSQL statement timeout), or error messages matching timeout/lock patterns.
2. An immediate single retry is attempted without duplicating side effects, moving money, or recording duplicate audit events.
3. `withAddressCache` isolates cache read/write errors from the database `fetcher()` so a database timeout never triggers a second `fetcher()` invocation and never writes failed responses to the cache.
4. If the timeout persists across the retry, `sendRecipientStreamsQueryError` maps the failure to HTTP `503 Service Unavailable` with code `DATABASE_TIMEOUT`.

---

## 4. Privacy & Zero-Credential Redaction

In accordance with system security standards:
- Stellar secret seeds (`^S[0-9A-Z]{55}$`), private keys, and API tokens are never reflected in error messages, validation details, or logs.
- Address paths and query parameters are logged with standard identifiers (`accountId`, `correlation_id`) without logging sensitive auth tokens.

---

## 5. Verification & Testing

Execute boundary and recovery test suites:
```bash
cd backend
npx vitest run src/recipientStreamsBoundary.test.ts src/recipientStreamsRecovery.test.ts
```
