# Create Stream Endpoint Boundary Behavior & Concurrency Recovery

**Batch ID**: SSB-2026-091  
**Area**: `backend`  
**Endpoint**: `POST /api/streams`

This document defines the boundary behavior, status codes, and deduplication semantics for the `Create Stream` endpoint when handling repeated requests after client timeouts and concurrent identical requests arriving together.

---

## 1. Problem Overview & Scope

Under distributed client network conditions, automated retry policies, or rapid user double-clicks:
1. **Repeat POST after a client timeout**: A client submits a stream creation request, experiences a network timeout or connection reset before reading the HTTP response, and automatically replays the exact same `POST /api/streams` request.
2. **Two identical requests arriving together**: Two identical creation requests with identical parameters (or identical idempotency keys) hit the server concurrently.

Without boundary protection, uncoordinated handlers would execute duplicate on-chain operations or database insertions, producing multiple distinct stream IDs and duplicate creation events for what was a single creation intent.

---

## 2. Boundary Input Behavior Matrix

| Scenario / Boundary Input | Detection Criteria | HTTP Status | Response Header / Code | Semantics & Operator Guarantee |
|---|---|---|---|---|
| **New Valid Stream** | Valid payload, not in-flight, not in idempotency cache | `201 Created` | Standard `201` JSON payload | Creates exactly 1 stream record and emits exactly 1 `created` event. Caches response for deduplication. |
| **Repeat POST after Timeout** | Identical payload / `Idempotency-Key` within 5m TTL window | `200 OK` | `X-Idempotent-Replay: true` | Replays the existing stream record and live progress. Creates 0 duplicate streams and 0 duplicate events. |
| **Concurrent Identical Requests** | Identical payload / `Idempotency-Key` while creation is in-flight | `409 Conflict` | `code: CONFLICT` | Rejects concurrent duplicate with deterministic error message: *"A stream creation request with identical parameters is currently in flight."* |
| **Validation Failure** | Invalid address, missing required fields, duration <= 0 | `400 Bad Request` | `VALIDATION_ERROR` | Fails fast prior to idempotency locking or transaction dispatch. |

---

## 3. Idempotency Key Determination

The endpoint supports explicit and deterministic identification:
- **Explicit Key**: `Idempotency-Key` or `X-Idempotency-Key` HTTP header.
- **Payload Fingerprint**: When explicit headers are absent, a deterministic fingerprint is derived from:
  `fp:${sender}:${recipient}:${assetCode}:${totalAmount}:${durationSeconds}:${startAt}`

---

## 4. Acceptance Criteria Verification

- [x] Boundary inputs produce deterministic status codes (`201` for new, `200` for repeat timeout replay, `409` for concurrent in-flight).
- [x] Does not silently duplicate streams or creation events.
- [x] Preserves existing documented behavior outside boundary retry/concurrency cases.
- [x] Full integration test suite in `backend/src/createStreamBoundary.test.ts`.
