# Contract ABI Reference

Public interface of the StellarStream Soroban contract
([`contracts/src/lib.rs`](../contracts/src/lib.rs)).

For how vesting is computed and how the contract behaves at the boundaries
(past start times, zero-duration streams, cancel-at-start, zero-amount claims,
rounding, pause/resume, …), see
[**Stream Math & Edge Cases**](./STREAM_MATH.md).

For generating typed TypeScript clients from this ABI, see
[`CONTRACT_BINDINGS.md`](./CONTRACT_BINDINGS.md).

---

## Types

### `Stream`

| Field | Type | Notes |
|-------|------|-------|
| `sender` | `Address` | Funds the escrow; may `cancel`, `pause`, `resume`. |
| `recipient` | `Address` | May `claim` and `transfer_stream`. |
| `token` | `Address` | Token address, or the native sentinel. |
| `total_amount` | `i128` | Escrowed amount (truncated on `cancel`). |
| `claimed_amount` | `i128` | Cumulative claimed (and clawed-back) amount. |
| `start_time` | `u64` | Vesting start (ledger timestamp). |
| `end_time` | `u64` | Vesting end; must be `> start_time`. |
| `cliff_seconds` | `u64` | No vesting until `start_time + cliff_seconds`. |
| `canceled` | `bool` | Set by `cancel`. |
| `paused` | `bool` | Set by `pause_stream`. |
| `pause_started_at` | `Option<u64>` | Freeze point while paused. |
| `metadata` | `Option<Map<String, String>>` | Optional key/value metadata. |

---

## Functions

| Function | Auth | Returns | Summary |
|----------|------|---------|---------|
| `initialize(admin, native_token, allowed_tokens)` | — (one-time) | — | Stores admin, native-token sentinel target, and allowlist. |
| `create_stream(sender, recipient, token, total_amount, start_time, end_time, cliff_seconds, metadata)` | `sender` | `u64` | Escrows funds and creates a linear stream; returns the stream id. |
| `create_split_stream(sender, token, total_amount, start_time, end_time, recipients)` | `sender` | `u64` | Creates one child stream per `(recipient, allocation)`; returns the parent id. |
| `get_split_children(parent_stream_id)` | — | `Vec<u64>` | Child stream ids of a split parent. |
| `get_stream(stream_id)` | — | `Stream` | Reads a stream (panics if unknown). |
| `get_next_stream_id()` / `get_stream_count()` | — | `u64` | Canonical stream counter. |
| `claimable(stream_id, at_time)` | — | `i128` | Vested-minus-claimed at `at_time`, floored at 0. |
| `get_claimable_batch(stream_ids, at_time)` | — | `Map<u64, i128>` | Batched `claimable` (max 20 ids). |
| `claim(stream_id, recipient, amount)` | `recipient` | `i128` | Transfers up to the claimable amount to the recipient. |
| `cancel(stream_id, sender)` | `sender` | — | Refunds unvested funds to sender; freezes schedule. Idempotent. |
| `transfer_stream(stream_id, new_recipient)` | current `recipient` | — | Reassigns the recipient. |
| `pause_stream(stream_id, sender)` | `sender` | — | Freezes vesting at the current time. |
| `resume_stream(stream_id, sender)` | `sender` | — | Shifts `start_time`/`end_time` forward by the paused duration. |
| `clawback(stream_id, amount, admin)` | `admin` | `i128` | Admin reclaims up to unclaimed-vested; returns amount clawed back. |
| `add_allowed_token(admin, token)` / `remove_allowed_token(admin, token)` | `admin` | — | Manage the token allowlist. |

---

## Error signals

The contract signals failures with `panic!` string messages rather than a numeric
`#[contracterror]` enum, so there are no stable numeric error codes to reference;
the exact panic string is the contract's error contract. The edge cases in
[`STREAM_MATH.md`](./STREAM_MATH.md#2-edge-cases) cross-reference these messages.

| Panic message | Raised by | Meaning |
|---------------|-----------|---------|
| `already initialized` | `initialize` | Called more than once. |
| `total_amount must be positive` | `create_stream`, `create_split_stream` | `total_amount <= 0`. |
| `end_time must be greater than start_time` | `create_stream`, `create_split_stream` | Zero-duration or inverted range. |
| `recipients must not be empty` | `create_split_stream` | No allocations provided. |
| `allocation must be positive` | `create_split_stream` | A per-recipient allocation `<= 0`. |
| `allocations must equal total_amount` | `create_split_stream` | Sum of allocations `!= total_amount`. |
| `ContractError::TokenNotAllowed` | `create_stream` | Non-native token absent from the allowlist. |
| `insufficient sender balance` | `create_stream`, `create_split_stream` | `balance(sender) < total_amount`. |
| `amount must be positive` | `claim`, `clawback` | Requested `amount <= 0`. |
| `amount exceeds claimable` | `claim` | `amount > claimable(now)` (includes pre-cliff / pre-start / canceled-cap). |
| `recipient mismatch` | `claim` | Caller is not the stream recipient. |
| `sender mismatch` | `cancel`, `pause_stream`, `resume_stream` | Caller is not the stream sender. |
| `stream not found` | any reader | Unknown `stream_id`. |
| `stream canceled` | `pause_stream` | Cannot pause a canceled stream. |
| `stream already paused` | `pause_stream` | Already paused. |
| `stream is not paused` | `resume_stream` | Resume without a preceding pause. |
| `too many stream ids` | `get_claimable_batch` | More than 20 ids in one batch. |
| `unauthorized` | `clawback`, allowlist admin fns | Caller is not the stored admin. |
| `contract not initialized` / `not initialized` | admin/native paths | Called before `initialize`. |
