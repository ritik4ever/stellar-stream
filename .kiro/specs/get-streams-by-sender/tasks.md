# Implementation Plan: get_streams_by_sender

## Overview

Five tasks implement the feature in dependency order: first add the storage key and query method, then wire up the two creation methods, then add tests, then update documentation. Tasks 2 and 3 can be done in parallel after Task 1 completes.

## Task Dependency Graph

```json
{
  "waves": [
    { "wave": 1, "tasks": ["1"] },
    { "wave": 2, "tasks": ["2", "3", "5"] },
    { "wave": 3, "tasks": ["4"] }
  ]
}
```

## Tasks

- [ ] 1. Add `SenderStreams(Address)` to `DataKey` and implement helper + query method
  - Add `SenderStreams(Address)` variant to the `DataKey` enum in `contracts/src/lib.rs`
  - Add private helper function `append_to_sender_index(env: &Env, sender: &Address, stream_id: u64)` that reads the existing `Vec<u64>` from `DataKey::SenderStreams(sender)` (defaulting to empty), appends the ID, and writes it back to persistent storage
  - Add public method `get_streams_by_sender(env: Env, sender: Address) -> Vec<u64>` that reads from `DataKey::SenderStreams(sender)` in persistent storage and returns it, or an empty `Vec` if absent
  - **File**: `contracts/src/lib.rs`
  - **Requirements**: Req 1 (all AC), Req 4 (all AC)

- [ ] 2. Update `create_stream` to maintain the sender index
  - After the two `env.storage().persistent().set(...)` calls (`NextStreamId` and `Stream(next_id)`) and before `env.events().publish(...)`, call `append_to_sender_index(&env, &sender, next_id)`
  - **File**: `contracts/src/lib.rs`
  - **Requirements**: Req 2 (AC 1, 2, 3, 4)
  - **Depends on**: Task 1

- [ ] 3. Update `create_split_stream` to maintain the sender index
  - Inside the per-recipient loop, after writing `DataKey::Stream(child_stream_id)` and `DataKey::ChildToParent(child_stream_id)`, call `append_to_sender_index(&env, &sender, child_stream_id)`
  - **File**: `contracts/src/lib.rs`
  - **Requirements**: Req 3 (all AC)
  - **Depends on**: Task 1

- [ ] 4. Add tests for `get_streams_by_sender`
  - Add `test_get_streams_by_sender_unknown_returns_empty` — unknown address returns empty `Vec`
  - Add `test_get_streams_by_sender_single_stream` — after one `create_stream`, returns `[id]`
  - Add `test_get_streams_by_sender_multiple_streams` — after 3 `create_stream` calls, returns all 3 IDs in order
  - Add `test_get_streams_by_sender_isolation` — two different senders have independent indexes with no cross-contamination
  - Add `test_get_streams_by_sender_split_stream` — after `create_split_stream` with 2 recipients, sender index contains both child IDs
  - Add `test_get_streams_by_sender_mixed` — `create_stream` + `create_split_stream` by same sender produces combined list in correct order
  - Add `test_get_streams_by_sender_100_streams` — 100 `create_stream` calls result in an index of length 100 in creation order
  - Run `cargo test` in the `contracts/` directory and confirm all tests pass
  - **File**: `contracts/src/test.rs`
  - **Requirements**: Req 2 (AC 3, 4), Req 3 (AC 2, 3), Req 4 (AC 2, 3), Req 5 (AC 2)
  - **Depends on**: Task 2, Task 3

- [ ] 5. Update `docs/CONTRACT_BINDINGS.md` with new method documentation
  - In the "Generated methods" table, add a row for `get_streams_by_sender` after the `cancel` row
  - After the `get_claimable_batch` usage example, add a `### \`get_streams_by_sender\`` section with a TypeScript code example showing how to call the method and iterate over the returned stream IDs
  - **File**: `docs/CONTRACT_BINDINGS.md`
  - **Requirements**: Req 6 (all AC)
  - **Depends on**: Task 1

## Notes

- No existing tests need to be modified — the new index is additive and does not change the behavior of existing methods.
- The `append_to_sender_index` helper is a private free function (not a method on the impl), consistent with how `read_stream` and `vested_amount` are implemented.
- The `SenderStreams` index is append-only: cancel, pause, resume, and transfer do not modify it.
- There is no migration for streams created before this deployment — the index only covers streams created after the updated contract is deployed.
- The 100-stream scalability test (`test_get_streams_by_sender_100_streams`) may need `env.budget().reset_unlimited()` if the Soroban test environment has a compute budget — check and add if tests fail with a budget error.
