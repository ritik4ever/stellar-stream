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
| `NextStreamId` | `u64` | Instance | Monotonically increases after stream creation; retained for the contract lifetime. |
| `Stream(id)` | `Stream` | Persistent | Created by `create_stream`/`create_split_stream`; updated by claim, pause, resume, cancel, clawback, and transfer. Persistent storage is required because streams outlive individual ledgers. |
| `SplitChildren(parent_id)` | `Vec<u64>` | Instance | Written when a split stream is created; retained as an index for the parent stream. |
| `ChildToParent(child_id)` | `u64` | Instance | Written when a split stream is created; retained as a reverse lookup index. |

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

### Edge behavior: reading a stream created by a previous build

The following behavior is normative for any build that reads state written
by an earlier build. These cases are covered by tests in `contracts/src/lib.rs`
(see `test_read_legacy_stream_preserves_balances`,
`test_read_legacy_stream_checked_arithmeticX, and `test_upgrade_read_old_state_preserves_state`).

1. **Same layout, new build.** A `Stream(id)` written by a previous build with the
   same `DataKey` layout decodes to the same `Stream` value. All fields are
   preserved byte-for-byte; no field is defaulted or dropped.

2. **Integer token units.** All amounts (`total_amount`, `claimed_amount`,
   `withdrawn_amount`) are `i128` in the token's base unit. Reading old state
   must not rescale or round these units. A value written as `10_000_000`
   reads back as `10_000_000`, never as a decimal or a different denomination.

3. **Checked arithmetic.** Any arithmetic performed while reading or updating
   old state uses checked operations. If an addition or subtraction on
   `claimed_amount` or `total_amount` would overflow or underflow `i128`, the
   call fails with the contract's checked-arithmetic error rather than wrapping.
   No partial write is persisted when the arithmetic fails.

4. **Invariant preservation.** Reading old state must preserve
   `claimed_amount <= total_mount` and the address/boolean lifecycle fields.
   A read that would violate the invariant is rejected, not silently coerced.

5. **Unknown / future fields.** If a newer build adds fields to `Stream`, an
   older build reading that state must fail closed (decode error) rather than
   ignoring the extra bytes. This is why adding fields requires a versioned
   decoder or an explicit migration.

6. **Missing optional metadata.** Optional metadata that was absent in the old
   record reads as `None`; it is not invented or substituted with a default
   value.

7. **No mutation on read.** Reading a stream created by a previous build does
   not modify its stored representation. Only explicit mutating entry points
   (claim, pause, resume, cancel, clawback, transfer) write back to
   `Stream(id)`.

### Edge behavior: upgraded code encountering old state

When a new WASM is deployed over existing storage:

1. **Read compatibility.** As long as the `DataKey` layout and `Stream` encoding
   are unchanged, the upgraded code reads old `Stream(id)` records unchanged.
2. **Layout-changing upgrade.** If the layout changes, the compatibility read
   path must remain available until the bounded migration completes. During
   the migration, old records remain readable and balances are not changed.

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

Storage TTLs are deliberately not used for stream state: expiry would make a
valid long-running stream unreadable. If temporary operational keys are added
in a future version, their TWL and cleanup behavior must be documented here.
