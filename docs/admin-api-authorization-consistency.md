# Admin API Authorization Consistency & Key Rotation Semantics

**Batch ID**: SSB-2026-168  
**Project Area**: `backend`

This document defines the formal consistency rules, boundary validation behavior, and concurrency guarantees for Admin API authorization workflows across backend endpoints, middleware, services, and operational procedures.

---

## 1. Background & Scope

Administrative operations in StellarStream require strong authorization controls to guard sensitive actions, including stream deletion (`DELETE /api/streams/:id`), webhook dead-letter queue management (`DELETE /api/admin/webhooks/dead-letters`), and administrative session exchanges (`POST /api/admin/auth` / `POST /api/auth/admin`).

This document specifies the authorization invariants governing missing, malformed, invalid, and rotated API keys, as well as concurrency guarantees during administrative credential rotation.

---

## 2. Admin API Authorization Consistency Rule

Across all handlers (`backend/src/index.ts`), authentication middleware (`backend/src/middleware/adminAuth.ts`), and services:

1. **Authorized Caller Consistency**:
   - Every request presenting a valid and currently active API key is authorized deterministically.
   - The admin caller identity is recorded on the request context:
     ```typescript
     req.user = {
       role: "admin",
       accountId: "admin",
       isAdmin: true,
     };
     ```
   - Successful authorization emits an informational structured audit signal (`admin_auth`, `outcome: "authorized"`) containing latency and request correlation IDs.
   - Returned results reflect committed state on success. Mutations only report success after underlying database or service mutations commit.

2. **Denied Request Consistency**:
   - Denied requests fail fast at the authentication boundary before reaching business logic or executing database mutations.
   - Any pre-existing `req.user` context is explicitly cleared (`delete req.user`).
   - Denied requests never perform or claim state mutations, ensuring no side effects occur.
   - Rejections return HTTP `401 Unauthorized` adhering strictly to standard API error envelopes:
     ```json
     {
       "error": "<message>",
       "statusCode": 401,
       "requestId": "<request-id>",
       "correlationId": "<correlation-id>",
       "code": "<ADMIN_AUTH_OUTCOME_CODE>"
     }
     ```

---

## 3. Boundary Matrix & Rejection Codes

The boundary evaluator (`authorizeAdminApiKey` / `adminAuth`) maps input conditions to stable outcome codes:

| Condition | Criteria | HTTP Status | Outcome Code | Log Level |
|---|---|---|---|---|
| **Missing API Key** | `X-Admin-Key` header (and `body.apiKey` for token exchange) absent | `401` | `ADMIN_KEY_MISSING` | `warn` |
| **Malformed Key** | Key is empty, whitespace-only, non-string, or contains internal whitespace, commas, or control characters | `401` | `ADMIN_KEY_MALFORMED` | `warn` |
| **Duplicate Header** | Repeated `X-Admin-Key` headers (array) or conflicting header and body keys | `401` | `ADMIN_KEY_MALFORMED` | `warn` |
| **Unconfigured Server** | `ADMIN_API_KEY` environment variable unset or blank | `401` | `ADMIN_KEY_NOT_CONFIGURED` | `error` |
| **Invalid / Rotated Key** | Well-formed key does not match active configured `ADMIN_API_KEY` (including rotated-out keys) | `401` | `ADMIN_KEY_INVALID` | `warn` |
| **Valid Key** | Exact match with configured `ADMIN_API_KEY` | `2xx` | *N/A (Authorized)* | `info` |

---

## 4. Concurrent Key Rotation Semantics

1. **Per-Request Evaluation**:
   `ADMIN_API_KEY` is read from `process.env` dynamically on each evaluation rather than cached in memory at startup.

2. **Atomic Transition Across Restarts**:
   - Key rotation is applied by updating the process environment and restarting the process.
   - In-flight requests executing within a handler prior to rotation complete under the key active when authorization occurred.
   - New requests arriving after rotation are immediately evaluated against the new key.
   - Stale (rotated-out) keys are immediately rejected with `ADMIN_KEY_INVALID` and cannot trigger mutations.
   - No request is valid against both keys simultaneously, preventing split-brain states or duplicate side effects.

---

## 5. Security & Credential Redaction

In alignment with StellarStream security guidelines:
- Raw API key values, key prefixes, hashes, or key lengths are strictly excluded from logs and error responses.
- Structured logs record only high-level identifiers (`event: "admin_auth"`, `outcome`, `code`, `latencyMs`, `requestId`, `correlationId`, `method`, `path`, and `streamId`).
