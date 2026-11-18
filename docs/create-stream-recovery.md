# Create Stream Endpoint Recovery Runbook (SSB-2026-092)

## Overview
This runbook documents the fault recovery and concurrency resilience mechanisms implemented for the `POST /api/streams` endpoint.

## Problem Statement
Network drops and client retry policies can lead to two critical failure patterns:
1. **Repeat POST after a client timeout**: A client submits a valid stream creation request, but experiences a socket timeout or network disconnection before receiving the HTTP 201 Created acknowledgment. The client subsequently retries with the same request payload.
2. **Two identical requests arriving together**: Rapid double-clicks or asynchronous race conditions trigger two identical creation requests concurrently within the same milliseconds window.

## Architectural Guarantees
- **Zero Duplicate Money-Moving Effects**: If a stream creation transaction has committed to the Stellar blockchain or local stream storage, subsequent retries bearing the same `Idempotency-Key` return the committed record with HTTP 200 and `X-Idempotent-Replay: true` header. No secondary Soroban transaction or ledger debit is initiated.
- **Strict In-Flight Concurrency Guard**: While an idempotency key is in-flight within `createStream`, concurrent requests with the identical key fail fast with HTTP 409 Conflict (`A stream creation request with identical parameters is currently in flight.`).
- **Safe Rollback & Lock Release**: In-flight locks are cleared in the `finally` block. In the event of a transient failure (e.g. RPC timeout), the lock is cleanly released, allowing a subsequent retry to execute without artificial lock starvation.

## Verification
- Unit and integration tests: `backend/src/createStreamRecovery.test.ts`.
