# Stellar Stream contract storage layout

This document describes the storage keys used by `StellarStreamContract`. The
key enum in `contracts/src/lib.rs` is the source of truth; any layout change
must update this document and the migration notes below in the same release.

## Key inventory

| Key | Value | Persistence | Lifecycle / TVL |
| --- | --- | --- | --- |
| `Admin` | `Address` | Instance | Written by `initialize`; retained for the contract lifetime. |
| `NativeToken` | `Address` | Instance | Written by `initialize`; retained for the contract lifetime. |
| `AllowedTokens` | `Vec<Address>` | Instance | Written by `initialize`, `add_allowed_token`, and `remove_allowed_token`; retained for the contract lifetime. |
| `NextStreamId` | `u64` | **Persistent** | Monotonically increases after stream creation. Must be **Persistent** — not Instance — so the counter survives ledger expiry and stream IDs never collide across upgrades. |
| `Stream(id)` | `Stream` | Persistent | Created by `create_stream`/`create_split_stream`; updated by claim, pause, resume, cancel, clawback, and transfer. Persistent storage is required because streams outlive individual ledgers. |
| `SplitChildren(parent_id)` | `Vec<u64>` | Instance | Written when a split stream is created; retained as an index for the parent stream. |
| `ChildToParent(child_id)` | `u64` | Instance | Written when a split stream is created; retained as a reverse lookup index. |
| `ContractVersion` | `u32` | Instance | Written by `initialize` with the value of `STREAM_LAYOUT_VERSION`. Upgrade scripts call `get_contract_version()` to compare this against the version compiled into the new WASM and detect whether a `Stream` layout migration is required. A missing key means the contract predates versioning; treat it as version 0. |

The legacy `EscrowVestingContract` at the top of `lib.rs` uses the string
instance keys `total_vested` (`ii28`) and `claimed_amount` (`ii28`). They are
independent of the `DataKey` layout and are retained for compatibility with
that legacy entry point.

## Budget estimate for 1,000 streams

The contract stores one `Stream(0..999)` record per stream. A stream contains
two addresses, one token address, five `u64`/boolean lifecycle fields, three
`i128` amounts, and optional metadata. A conservative planning estimate is
approximately 0.5–1.5 KiB per stream before Soroban serialization overhead,
or roughly 0.5–1.5 MiB for 1,000 streams. Split streams additionally require
one child index and one reverse index entry per child, plus the vector entry on
each parent. Real budgets must be measured with the target SDK and metadata
size; the estimate is not a protocol limit.

## Upgrade and migration impact

DataKey variants and the encoded fields of `Stream` are persistent ABI. New
variants should be appended, not reordered. Adding fields to `Stream` requires
a versioned decoder or an explicit migration because old serialized values
cannot be assumed to contain the new field. Existing `Stream(id)` records must
remain readable throughout the migration.



Before deploying a layout-changing WASM:

1. Freeze new stream creation or gate it behind a migration version.
2. Snapshot and validate `NextStreamId`, all stream records, and both split
   indexes.
3. Run a bounded, resumable migration that rewrites each old `Stream(id)` into
   the new representation without changing balances or claimed amounts.
4. Verify conservation (`claimed_amount <= total_amount`) and that every child
   has a matching `ChildToParent` entry.
5. Keep a compatibility read path until the migration is complete, then bump
   the documented contract version and re-run the ABI/storage audit.

### Authority over existing state

An upgraded build must derive authority from the `sender` and `recipient`
recorded in the stored `Stream(id)`, never from caller-supplied arguments
alone:

| Entry point | Required signer (from stored record) |
| --- | --- |
| `claim` | `recipient` |
| `transfer_stream` | `recipient` |
| `cancel`, `pause_stream`, `resume_stream` | `sender` |
| `clawback` | stored `Admin` |

Each check runs before any token transfer or storage write, so an
unauthorized call leaves balances and the stream record unchanged. After
`transfer_stream`, only the new recipient can claim. The
`test_prior_build_stream_*` tests in `src/test.rs` seed a record directly in
storage, as a previous build would have left it, and verify these rules with
auth enforcement on. Any layout-changing migration must keep them passing.

Storage TTLs are deliberately not used for stream state: expiry would make a
valid long-running stream unreadable. If temporary operational keys are added
in a future version, their TWL and cleanup behavior must be documented here.

## Event payload stability (stable ABI)

The field names and types listed below are a **stable ABI** consumed by
`backend/src/services/indexer.ts` via `scValToNative`.  Any rename or type
change is a breaking change that requires a coordinated indexer update.

### Mandatory base fields (present on every event struct, in this declared order)

| Field | Type | Description |
| --- | --- | --- |
| `stream_id` | `u64` | Identifies the stream this event belongs to. |
| `actor` | `Address` | On-chain address that triggered the event. |
| `timestamp` | `u64` | Ledger close time (Unix seconds) at emission. |

These three fields are always declared first in every event struct.
Adding new optional fields after the mandatory base is permitted; removing or
reordering the mandatory base fields is a breaking change.

### Event-specific fields the indexer reads

| Event | Fields consumed by indexer |
| --- | --- |
| `StreamCreated` | `sender`, `recipient`, `token`, `total_amount`, `start_time`, `end_time` |
| `StreamClaimed` | `amount`, `claimed_amount` |
| `StreamCompleted` | `total_amount` |
| `StreamCanceled` | `sender`, `refunded_amount` |
| `StreamPaused` | `sender`, `paused_at` |
| `StreamResumed` | `sender`, `resumed_at` |
| `StreamTransferred` | `old_recipient`, `new_recipient` |
| `ClawbackExecuted` | `amount`, `recipient` |

### Event topic keys (stable)

Events are published under the two-symbol topic `("Stream", <name>)`:

| Event struct | topic[0] | topic[1] |
| --- | --- | --- |
| `StreamCreated` | `"Stream"` | `"Created"` |
| `StreamClaimed` | `"Stream"` | `"Claimed"` |
| `StreamCompleted` | `"Stream"` | `"Completed"` |
| `ClaimThrottled` | `"Stream"` | `"Throttled"` |
| `StreamCanceled` | `"Stream"` | `"Canceled"` |
| `StreamPaused` | `"Stream"` | `"Paused"` |
| `StreamResumed` | `"Stream"` | `"Resumed"` |
| `StreamTransferred` | `"Stream"` | `"Transfer"` |
| `ClawbackExecuted` | `"Stream"` | `"Clawback"` |

The indexer routes events by `topic[1]`.  These strings must not change.

---

## Event emission ordering guarantee

Within a single Soroban transaction the contract emits events in the following
fixed order.  The indexer relies on this ordering to reconstruct the committed
action **exactly once** without double-counting.

### `create_stream()` / `create_split_stream()` (Stream creation escrow)

1. **Token transfer / Escrow**: Tokens are transferred from `sender` to `contract_address` (`total_amount`). The underlying token contract emits its transfer event first.
2. **State persistence**: `DataKey::NextStreamId` is incremented and `DataKey::Stream(next_id)` is committed to persistent storage.
3. `StreamCreated`: Emitted **after** escrowed token transfer and storage persistence succeed (one per child stream for split streams). The indexer reconstructs the initial stream state (`sender`, `recipient`, `token`, `total_amount`, `start_time`, `end_time`, `cliff_seconds`, `vesting_type`, `min_claim_interval_seconds`, `metadata`) **exactly once**.
4. **Failure atomicity**: If the sender balance is insufficient, authorization fails, or any validation fails before storage, the invocation reverts atomically. Zero contract events are emitted, no stream ID is consumed, and escrowed balances remain unchanged.

### `claim()` call

1. `StreamClaimed` — always emitted after the token transfer and accounting
   update succeed.  The indexer records the claim from this event.
2. `StreamCompleted` — emitted **immediately after** `StreamClaimed` in the
   same transaction, **only** when `claimed_amount >= total_amount` after the
   claim.  The indexer uses this event as a completion signal; it must not
   re-count the amount from `StreamCompleted`.

No other events are emitted by a successful `claim()` call (unless the
call is first rejected by the rate-limiter, in which case `ClaimThrottled` is
emitted and both `StreamClaimed` and `StreamCompleted` are suppressed).

#### `StreamClaimed` as the authoritative partial-claim record

`StreamClaimed` is a self-describing record of a single committed claim. Its
event-specific fields are:

| Field | Meaning |
| --- | --- |
| `amount` | The recipient payout transferred to the recipient by **this** call. |
| `claimed_amount` | The cumulative claimed balance **after** this call succeeds. |

A partial claim is a "one-unit claim followed by the remaining claim": the
recipient first pulls out a small amount, then claims the rest. Each successful
call emits exactly one `StreamClaimed`, so an indexer that never reads contract
storage reconstructs the committed payout by summing the `amount` fields and reads
the resulting balance from the latest `claimed_amount` — the two agree event by
event, so nothing is missed or double-counted. `StreamCompleted` carries only
`total_amount` and must never be used as a payout amount. Because `claim()`
publishes `StreamClaimed` only after the token transfer and the accounting update
both succeed, a claim whose payout fails after the recipient has authorized
reverts the whole transaction: no `StreamClaimed` is emitted and `claimed_amount`
is not advanced, so the indexer records exactly the payouts that actually happened.

This event-only reconstruction is tested by
`test_1137_events_reconstruct_partial_claim_state_exactly_once` in
`contracts/src/test.rs`; the underlying claim mechanics and the failed-payout
rollback are covered by `test_1138_one_unit_claim_then_remaining_claim` and
`test_1138_transfer_failure_after_authorization_rolls_back`.

### Other entry points (one event each)

| Entry point | Event emitted |
| --- | --- |
| `create_stream` / `create_split_stream` | `StreamCreated` (one per child for split) |
| `cancel` | `StreamCanceled` |
| `pause_stream` | `StreamPaused` |
| `resume_stream` | `StreamResumed` |
| `transfer_stream` | `StreamTransferred` |
| `clawback` | `ClawbackExecuted` |

This ordering is tested by `test_claim_event_ordering_claimed_before_completed`
in `contracts/src/test.rs`.

---

## Upgrade compatibility version

`STREAM_LAYOUT_VERSION` (`u32`, currently `1`) is a compile-time constant in
`contracts/src/lib.rs`. Its value is written to the `ContractVersion` instance
storage key by `initialize` and can be queried at any time via
`get_contract_version()`. After migrating an existing deployment, the admin
records the new version by calling `set_contract_version()`.

**Upgrade procedure when the layout changes:**

1. Bump `STREAM_LAYOUT_VERSION` in `lib.rs`.
2. Follow the migration checklist in "Upgrade and migration impact" above.
3. After the migration completes, update `DataKey::ContractVersion` in instance
3. After the migration completes, call `set_contract_version()` as the admin
   with the new version number. The setter rejects downgrades and versions
   newer than the running build supports.
4. Update the "currently `N`" note in this document.
