# Stellar Stream contract storage layout

This document describes the storage keys used by `StellarStreamContract`. The
key enum in `contracts/src/lib.rs` is the source of truth; any layout change
must update this document and the migration notes below in the same release.

## Key inventory

| Key | Value | Persistence | Lifecycle / TTL |
| --- | --- | --- | --- |
| `Admin` | `Address` | Instance | Written by `initialize`; retained for the contract lifetime. |
| `NativeToken` | `Address` | Instance | Written by `initialize`; retained for the contract lifetime. |
| `AllowedTokens` | `Vec<Address>` | Instance | Written by `initialize`, `add_allowed_token`, and `remove_allowed_token`; retained for the contract lifetime. |
| `NextStreamId` | `u64` | Instance | Monotonically increases after stream creation; retained for the contract lifetime. |
| `Stream(id)` | `Stream` | Persistent | Created by `create_stream`/`create_split_stream`; updated by claim, pause, resume, cancel, clawback, and transfer. Persistent storage is required because streams outlive individual ledgers. |
| `SplitChildren(parent_id)` | `Vec<u64>` | Instance | Written when a split stream is created; retained as an index for the parent stream. |
| `ChildToParent(child_id)` | `u64` | Instance | Written when a split stream is created; retained as a reverse lookup index. |

The legacy `EscrowVestingContract` at the top of `lib.rs` uses the string
instance keys `total_vested` (`i128`) and `claimed_amount` (`i128`). They are
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

`DataKey` variants and the encoded fields of `Stream` are persistent ABI. New
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

Storage TTLs are deliberately not used for stream state: expiry would make a
valid long-running stream unreadable. If temporary operational keys are added
in a future version, their TTL and cleanup behavior must be documented here.
