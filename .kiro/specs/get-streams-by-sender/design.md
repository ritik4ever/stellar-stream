# Design Document

## Overview

This document describes the technical design for adding `get_streams_by_sender` to the `StellarStreamContract`. The change is additive: a new `DataKey` variant is introduced, two existing creation methods are updated to maintain the index, and one new read-only method is added. No existing storage entries are modified or migrated.

## Architecture

### Component Diagram

```
contracts/src/lib.rs
├── DataKey (enum)
│   └── + SenderStreams(Address)         ← NEW variant
│
├── StellarStreamContract (impl)
│   ├── create_stream()                  ← UPDATE: append to SenderStreams index
│   ├── create_split_stream()            ← UPDATE: append all child IDs to SenderStreams index
│   └── get_streams_by_sender()          ← NEW: read-only query
│
docs/CONTRACT_BINDINGS.md               ← UPDATE: table row + TS usage example
```

There are no backend API changes, database changes, or new dependencies.

## Data Model

### New `DataKey` Variant

```rust
#[contracttype]
pub enum DataKey {
    Admin,
    NextStreamId,
    Stream(u64),
    SplitChildren(u64),
    ChildToParent(u64),
    NativeToken,
    AllowedTokens,
    SenderStreams(Address),   // NEW
}
```

**Storage tier**: `env.storage().persistent()`

**Value type**: `Vec<u64>` — ordered list of stream IDs in creation order.

**Key behavior**:
- Missing key → treated as `Vec::new(&env)` (same pattern as `SplitChildren`).
- Each `create_stream` appends one ID.
- Each `create_split_stream` appends N child IDs (one per recipient).
- The entry is never shrunk — cancel, pause, and resume do not touch it.

### Unchanged Data

The `Stream` struct is **not modified**. The index is purely an additional reverse-lookup layer; the canonical stream data remains in `DataKey::Stream(u64)`.

## Helper Function

A private helper encapsulates the read-modify-write pattern to keep both `create_stream` and `create_split_stream` DRY:

```rust
fn append_to_sender_index(env: &Env, sender: &Address, stream_id: u64) {
    let mut ids: Vec<u64> = env
        .storage()
        .persistent()
        .get(&DataKey::SenderStreams(sender.clone()))
        .unwrap_or_else(|| Vec::new(env));
    ids.push_back(stream_id);
    env.storage()
        .persistent()
        .set(&DataKey::SenderStreams(sender.clone()), &ids);
}
```

This helper is called once per stream ID that must be indexed. For `create_split_stream`, it is called once per child inside the recipient loop (after writing `DataKey::Stream(child_id)`).

## Method Implementations

### `create_stream` — updated section

After the two existing `env.storage().persistent().set(...)` calls and before `env.events().publish(...)`, add:

```rust
append_to_sender_index(&env, &sender, next_id);
```

The full ordering within the method becomes:
1. Validate inputs, check token allowlist, check sender balance
2. Transfer tokens to escrow
3. Assign `next_id`
4. Build `stream` struct
5. Write `DataKey::NextStreamId`
6. Write `DataKey::Stream(next_id)`
7. **Append `next_id` to `DataKey::SenderStreams(sender)`** ← new step
8. Publish `StreamCreated` event
9. Return `next_id`

### `create_split_stream` — updated section

Inside the per-recipient loop, after writing `DataKey::Stream(child_stream_id)` and `DataKey::ChildToParent(child_stream_id)`, add:

```rust
append_to_sender_index(&env, &sender, child_stream_id);
```

The per-recipient loop order becomes:
1. Validate allocation > 0
2. Build `child_stream` struct
3. Write `DataKey::Stream(child_stream_id)`
4. Write `DataKey::ChildToParent(child_stream_id)`
5. **Append `child_stream_id` to `DataKey::SenderStreams(sender)`** ← new step
6. Push `child_stream_id` into `child_ids`
7. Publish `StreamCreated` event for child

### New `get_streams_by_sender` method

```rust
pub fn get_streams_by_sender(env: Env, sender: Address) -> Vec<u64> {
    env.storage()
        .persistent()
        .get(&DataKey::SenderStreams(sender))
        .unwrap_or_else(|| Vec::new(&env))
}
```

This method is read-only, requires no auth, and never panics.

## Test Plan

New tests in `contracts/src/test.rs`:

| Test name | What it verifies |
|---|---|
| `test_get_streams_by_sender_unknown_returns_empty` | Returns empty `Vec` for an address that has never created a stream |
| `test_get_streams_by_sender_single_stream` | After one `create_stream`, returns a `Vec` with exactly that stream ID |
| `test_get_streams_by_sender_multiple_streams` | After N `create_stream` calls, returns all N IDs in creation order |
| `test_get_streams_by_sender_isolation` | Two different senders have separate indexes with no cross-contamination |
| `test_get_streams_by_sender_split_stream` | After `create_split_stream` with 2 recipients, sender index contains both child IDs |
| `test_get_streams_by_sender_mixed` | After `create_stream` + `create_split_stream`, sender index contains all IDs from both calls |
| `test_get_streams_by_sender_100_streams` | After 100 `create_stream` calls, sender index has exactly 100 entries in order |

## Documentation Changes

### `docs/CONTRACT_BINDINGS.md` — "Generated methods" table

Add one row after the `cancel` row:

```markdown
| `get_streams_by_sender` | `getStreamsBySender(sender) → u64[]` | Read-only; returns empty array for unknown senders |
```

### `docs/CONTRACT_BINDINGS.md` — new usage example section

Add after the `get_claimable_batch` example:

```markdown
### `get_streams_by_sender` — Fetching all streams for a sender

```typescript
import { streamContract } from "./contractClient";

async function fetchSenderStreams(sender: string): Promise<bigint[]> {
  // Returns an array of stream IDs (u64) for the given sender.
  // Returns [] if the sender has no streams — never throws.
  const streamIds = await streamContract.getStreamsBySender({ sender });
  return streamIds; // bigint[]
}

// Example: load and display all streams for a wallet address
const ids = await fetchSenderStreams("GABC...XYZ");
console.log(`Sender has ${ids.length} streams: ${ids.join(", ")}`);
```
```

## Constraints and Non-Goals

- **No migration**: streams created before this change are not retroactively indexed. The index only reflects streams created after deployment.
- **No removal from index**: canceling, completing, or pausing a stream does not remove its ID from `SenderStreams`. The index is an append-only creation log.
- **No authorization on query**: `get_streams_by_sender` is public and unauthenticated — consistent with `get_stream`, `get_split_children`, and other read methods.
- **No pagination**: the method returns the full `Vec<u64>`. Callers needing paging can slice the returned array off-chain.
