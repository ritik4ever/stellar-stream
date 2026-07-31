# StellarStream Contract Event Schema

This document describes every event emitted by the StellarStream Soroban contract
(`contracts/src/lib.rs`). The indexer worker (`backend/src/services/indexer.ts`)
reads these events from Stellar RPC and writes them to the SQLite `stream_events`
table for the frontend to display.

---

## Overview

### Event Topics

Every event is published with a two-symbol topic tuple:

```
(Symbol("Stream"), Symbol("<EventName>"))
```

The indexer matches on `topic[1]` (the event name) to dispatch to the correct
handler.

### Mandatory Base Fields

**All** StellarStream events carry these three fields regardless of type:

| Field       | Type      | Description                                                       |
|-------------|-----------|-------------------------------------------------------------------|
| `stream_id` | `u64`     | Numeric ID of the stream this event belongs to.                   |
| `actor`     | `Address` | On-chain address of the party who triggered the event.            |
| `timestamp` | `u64`     | Ledger close time in Unix seconds at the moment of emission.      |

Additional fields are event-specific and documented in each section below.

---

## Events

### StreamCreated

**Topic:** `("Stream", "Created")`  
**Triggered by:** `create_stream()`, `create_split_stream()`  
**Actor:** The sender who funded the stream.

| Field           | Type                         | Description                                               |
|-----------------|------------------------------|-----------------------------------------------------------|
| `stream_id`     | `u64`                        | Unique stream identifier.                                 |
| `actor`         | `Address`                    | Sender address (same as `sender` field).                  |
| `timestamp`     | `u64`                        | Ledger close time when the stream was created.            |
| `sender`        | `Address`                    | Account that funded the stream.                           |
| `recipient`     | `Address`                    | Account entitled to claim tokens.                         |
| `token`         | `Address`                    | Contract address of the streamed token.                   |
| `token_symbol`  | `String`                     | Symbol of the token (e.g. `"USDC"`).                     |
| `total_amount`  | `i128`                       | Total tokens locked in the stream (in stroops).           |
| `start_time`    | `u64`                        | Unix timestamp when vesting begins.                       |
| `end_time`      | `u64`                        | Unix timestamp when vesting ends.                         |
| `cliff_seconds` | `u64`                        | Seconds after `start_time` before any tokens vest.        |
| `metadata`      | `Option<Map<String,String>>` | Optional key-value metadata attached to the stream.       |

**Indexer mapping:** event type `"created"`, amount = `total_amount`, metadata includes `recipient`, `token`, `startTime`, `endTime`.

---

### StreamClaimed

**Topic:** `("Stream", "Claimed")`  
**Triggered by:** `claim()`  
**Actor:** The recipient performing the claim.

| Field            | Type      | Description                                                   |
|------------------|-----------|---------------------------------------------------------------|
| `stream_id`      | `u64`     | Stream identifier.                                            |
| `actor`          | `Address` | Recipient address (same as `recipient` field).                |
| `timestamp`      | `u64`     | Ledger close time when the claim occurred.                    |
| `recipient`      | `Address` | Account that received the tokens.                             |
| `amount`         | `i128`    | Tokens transferred in this claim (in stroops).                |
| `claimed_amount` | `i128`    | Cumulative total claimed after this operation (in stroops).   |

**Indexer mapping:** event type `"claimed"`, amount = `amount`, metadata includes `claimed_amount`.

> **Note:** When a claim causes `claimed_amount >= total_amount`, a `StreamCompleted`
> event is also emitted in the same transaction immediately after `StreamClaimed`.

---

### StreamCompleted

**Topic:** `("Stream", "Completed")`  
**Triggered by:** `claim()` — emitted only when the final claim fully drains the stream.  
**Actor:** The recipient whose claim completed the stream.

| Field          | Type      | Description                                               |
|----------------|-----------|-----------------------------------------------------------|
| `stream_id`    | `u64`     | Stream identifier.                                        |
| `actor`        | `Address` | Recipient who made the completing claim.                  |
| `timestamp`    | `u64`     | Ledger close time when completion was reached.            |
| `total_amount` | `i128`    | Total amount that was streamed (in stroops).              |

**Indexer mapping:** event type `"completed"`, amount = `total_amount`.

---

### StreamCanceled

**Topic:** `("Stream", "Canceled")`  
**Triggered by:** `cancel()`  
**Actor:** The sender who canceled the stream.

| Field             | Type      | Description                                                        |
|-------------------|-----------|--------------------------------------------------------------------|
| `stream_id`       | `u64`     | Stream identifier.                                                 |
| `actor`           | `Address` | Sender address (same as `sender` field).                           |
| `timestamp`       | `u64`     | Ledger close time when the cancellation was recorded.              |
| `sender`          | `Address` | Account that canceled the stream.                                  |
| `refunded_amount` | `i128`    | Unvested tokens refunded to the sender (in stroops). May be `0`.   |

**Indexer mapping:** event type `"canceled"`, amount = `refunded_amount`.

---

### StreamPaused

**Topic:** `("Stream", "Paused")`  
**Triggered by:** `pause_stream()`  
**Actor:** The sender who paused the stream.

| Field       | Type      | Description                                                  |
|-------------|-----------|--------------------------------------------------------------|
| `stream_id` | `u64`     | Stream identifier.                                           |
| `actor`     | `Address` | Sender address (same as `sender` field).                     |
| `timestamp` | `u64`     | Ledger close time when the pause was recorded.               |
| `sender`    | `Address` | Account that paused the stream.                              |
| `paused_at` | `u64`     | Ledger close time at which vesting was frozen (Unix seconds).|

**Indexer mapping:** event type `"paused"`, metadata includes `paused_at`.

---

### StreamResumed

**Topic:** `("Stream", "Resumed")`  
**Triggered by:** `resume_stream()`  
**Actor:** The sender who resumed the stream.

| Field        | Type      | Description                                                    |
|--------------|-----------|----------------------------------------------------------------|
| `stream_id`  | `u64`     | Stream identifier.                                             |
| `actor`      | `Address` | Sender address (same as `sender` field).                       |
| `timestamp`  | `u64`     | Ledger close time when the resume was recorded.                |
| `sender`     | `Address` | Account that resumed the stream.                               |
| `resumed_at` | `u64`     | Ledger close time at which vesting restarted (Unix seconds).   |

**Indexer mapping:** event type `"resumed"`, metadata includes `resumed_at`.

---

### StreamTransferred *(bonus — emitted by `transfer_stream`)*

**Topic:** `("Stream", "Transfer")`  
**Triggered by:** `transfer_stream()`  
**Actor:** The previous recipient who authorized the transfer.

| Field           | Type      | Description                                          |
|-----------------|-----------|------------------------------------------------------|
| `stream_id`     | `u64`     | Stream identifier.                                   |
| `actor`         | `Address` | Old recipient address (same as `old_recipient`).     |
| `timestamp`     | `u64`     | Ledger close time when the transfer was recorded.    |
| `old_recipient` | `Address` | Account transferring away the stream rights.         |
| `new_recipient` | `Address` | Account receiving the stream rights.                 |

**Indexer mapping:** event type `"transferred"`, metadata includes `new_recipient`.

---

### ClawbackExecuted *(bonus — emitted by `clawback`)*

**Topic:** `("Stream", "Clawback")`  
**Triggered by:** `clawback()`  
**Actor:** The admin address that authorized the clawback.

| Field       | Type      | Description                                                   |
|-------------|-----------|---------------------------------------------------------------|
| `stream_id` | `u64`     | Stream identifier.                                            |
| `actor`     | `Address` | Admin address (same as `recipient` field).                    |
| `timestamp` | `u64`     | Ledger close time when the clawback was executed.             |
| `amount`    | `i128`    | Tokens clawed back from the stream (in stroops).              |
| `recipient` | `Address` | Admin account that received the clawed-back tokens.           |

**Indexer mapping:** event type `"clawback"`, amount = `amount`, metadata includes `recipient`.

---

## Event Ordering Guarantees

Within a single transaction:

- `create_stream` → exactly one `StreamCreated`
- `create_split_stream` → exactly one `StreamCreated` per child stream, in allocation order
- `claim` → exactly one `StreamClaimed`, followed by at most one `StreamCompleted` (only when the stream is fully drained)
- `cancel` → exactly one `StreamCanceled`
- `pause_stream` → exactly one `StreamPaused`
- `resume_stream` → exactly one `StreamResumed`
- `transfer_stream` → exactly one `StreamTransferred`
- `clawback` → exactly one `ClawbackExecuted` (only when `actual_clawback > 0`)

---

## Indexer Event Type Mapping

The table below maps contract event names to the `eventType` strings stored in the
`stream_events` SQLite table and returned by `GET /api/streams/:id/history`.

| Contract event topic | `eventType` in DB  | `actor` field source            |
|----------------------|--------------------|---------------------------------|
| `Created`            | `created`          | `sender`                        |
| `Claimed`            | `claimed`          | `recipient`                     |
| `Completed`          | `completed`        | `recipient` (final claimant)    |
| `Canceled`           | `canceled`         | `sender`                        |
| `Paused`             | `paused`           | `sender`                        |
| `Resumed`            | `resumed`          | `sender`                        |
| `Transfer`           | `transferred`      | `old_recipient`                 |
| `Clawback`           | `clawback`         | `admin`                         |

---

## Adding New Events

To add a new event type:

1. Define a `#[contracttype]` struct in `contracts/src/lib.rs` with the three
   mandatory base fields (`stream_id`, `actor`, `timestamp`) plus any
   event-specific fields.
2. Call `env.events().publish((symbol_short!("Stream"), symbol_short!("<Name>")), <Struct> { ... })` inside the relevant contract function.
3. Add a `case "<Name>":` branch in `processEvent()` inside
   `backend/src/services/indexer.ts` and call `recordEventWithDb`.
4. Document the new event in this file.
