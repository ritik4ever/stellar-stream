# Persist Streams On Soroban

- Complexity: High
- Points: 200
- Labels: `stellar-wave`, `soroban`, `enhancement`

## Problem
Streams are currently stored in backend memory. They reset when the server restarts.

## Scope
- Call Soroban contract on stream creation.
- Store the on-chain `stream_id`.
- Read stream state from chain for status.

## Acceptance Criteria
- Creating a stream writes to Soroban contract.
- API returns on-chain `stream_id`.
- Restarting backend does not lose stream data.
