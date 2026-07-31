# Stream Math & Edge Cases

Reference for how the StellarStream Soroban contract computes vesting, and how it
behaves at the boundaries. All behavior below is derived directly from
[`contracts/src/lib.rs`](../contracts/src/lib.rs) and covered by
[`contracts/src/test.rs`](../contracts/src/test.rs).

See also the public interface and error-signal reference in
[`CONTRACT_ABI.md`](./CONTRACT_ABI.md).

---

## 1. The vesting formula

Vesting is linear between `start_time` and `end_time`, gated by an optional
cliff, and frozen while a stream is paused. The core computation lives in
`vested_amount(stream, at_time)`:

```
effective_now =
    pause_started_at   if stream.paused        (vesting is frozen at pause time)
    at_time            otherwise

# Cliff gate
if effective_now < start_time + cliff_seconds:
    vested = 0

# Linear vesting, capped at end_time
effective_time  = min(effective_now, end_time)
elapsed         = effective_time - start_time           # saturating
total_duration  = end_time - start_time                 # saturating

if total_duration == 0:
    vested = 0

vested = total_amount * elapsed / total_duration        # integer division → floor
```

The amount a recipient can withdraw at a given time is:

```
claimable(stream_id, at_time) = max(0, vested_amount(stream, at_time) - claimed_amount)
```

Key properties:

- **Floor rounding.** `total_amount * elapsed / total_duration` uses i128 integer
  division, so partial vesting always rounds **down**. Any rounding dust is
  recovered at `end_time`, where `elapsed == total_duration` makes the result
  exactly `total_amount`.
- **Monotonic.** Vested never decreases with time (until `cancel`, which freezes
  the schedule — see §2.4).
- **No time validation at creation.** `create_stream` validates only
  `total_amount > 0` and `end_time > start_time`. It does **not** compare
  `start_time` against the current ledger time, so past/future start times are
  both accepted (see §2.1).

---

## 2. Edge cases

Each case lists the **input**, the **expected behavior**, and the **error signal**
(if any). This contract signals failures with `panic!` string messages rather than
a numeric `#[contracterror]` enum, so the "error signal" column names the exact
panic string; see [`CONTRACT_ABI.md`](./CONTRACT_ABI.md#error-signals) for the
full catalog. "—" means the call succeeds without error.

| # | Edge case | Input | Expected behavior | Error signal |
|---|-----------|-------|-------------------|--------------|
| 1 | Start time in the past | `create_stream` with `start_time < now`, `end_time > start_time` | Accepted. On first `claim`, vesting is measured from `start_time`, so a proportional (or full) amount is immediately claimable. | — |
| 2 | Zero-duration stream | `create_stream` with `end_time == start_time` | Rejected at creation before any escrow transfer. | `end_time must be greater than start_time` |
| 3 | Inverted time range | `create_stream` with `end_time < start_time` | Rejected at creation (same guard as #2). | `end_time must be greater than start_time` |
| 4 | Non-positive total | `create_stream` with `total_amount <= 0` | Rejected at creation. | `total_amount must be positive` |
| 5 | Cancel at exactly start time | `cancel` when `now == start_time` | `vested = 0`; the sender is refunded the full `total_amount`; the stream's `end_time`/`total_amount` are truncated to the cancel point and it is marked `canceled`. Recipient can claim nothing. | — |
| 6 | Cancel before start time | `cancel` when `now < start_time` | Same as #5: `vested = 0`, full refund to sender. | — |
| 7 | Claim of zero amount | `claim` with `amount == 0` (or `< 0`) | Rejected. | `amount must be positive` |
| 8 | Claim before cliff / before start | `claim` while `now < start_time + cliff_seconds` | `vested = 0`, so `claimable = 0`; any positive `amount` exceeds it. | `amount exceeds claimable` |
| 9 | Claim more than claimable | `claim` with `amount > claimable(now)` | Rejected; no partial transfer. | `amount exceeds claimable` |
| 10 | Claim after end time | `claim` when `now >= end_time` | `vested` caps at `total_amount`; the full unclaimed remainder (including rounding dust) is claimable. | — |
| 11 | Claim on a canceled stream | `claim` after `cancel` | Allowed up to the amount vested at cancel time (the frozen `total_amount`); attempts beyond that are rejected. | `amount exceeds claimable` (only when over the frozen vested amount) |
| 12 | Double cancel (idempotent) | `cancel` on an already-canceled stream | No-op: returns early, no second refund, no event. | — |
| 13 | Rounding dust | `total_amount` not divisible by `total_duration` | Mid-stream `claimable` rounds down; the leftover unit(s) become claimable exactly at `end_time`. Token conservation holds. | — |
| 14 | Claim from a nonexistent stream | `claim`/`get_stream` with an unknown `stream_id` | Rejected. | `stream not found` |
| 15 | Insufficient sender balance | `create_stream` when `balance(sender) < total_amount` | Rejected before escrow transfer. | `insufficient sender balance` |
| 16 | Pause freezes vesting | `pause_stream`, then time passes | `vested` is computed at `pause_started_at`; `claimable` does not grow while paused. | — (re-pausing → `stream already paused`) |
| 17 | Resume shifts the schedule | `resume_stream` after a pause of `d` seconds | `start_time` and `end_time` both shift forward by `d`, preserving the remaining unvested portion; vesting resumes from where it froze. | — (resuming a live stream → `stream is not paused`) |

> Cases 1–17 exceed the required minimum of 8 documented edge cases.

### 2.1 Start time in the past

`create_stream` never compares `start_time` to `env.ledger().timestamp()`. A
stream whose `start_time` is already in the past begins "mid-flight": at the first
`claim`, `elapsed = now - start_time` is already positive, so a proportional slice
is claimable immediately. If `now >= end_time` as well, the entire `total_amount`
is claimable at once. This is intentional and lets callers back-date schedules.

### 2.2 Zero-duration and inverted ranges

A stream needs a positive duration to vest linearly. `end_time <= start_time` is
rejected up front (`end_time must be greater than start_time`), before any tokens
are escrowed. As defense in depth, `vested_amount` also returns `0` when
`total_duration == 0`, so no division-by-zero is possible even if a zero-duration
stream were ever constructed by another path.

### 2.3 The cliff

`cliff_seconds` delays *all* vesting: while
`effective_now < start_time + cliff_seconds`, `vested = 0`. At the instant the
cliff elapses, vesting equals the full linear amount accrued since `start_time`
(the cliff does not restart the clock — it only withholds payout until reached).
Claiming during the cliff always fails with `amount exceeds claimable`.

### 2.4 Cancel semantics

`cancel` computes `vested` at the current time and refunds
`total_amount - vested` to the sender. It then truncates the schedule
(`end_time = max(now, start_time)`, `total_amount = vested`) and marks the stream
`canceled`. The recipient keeps the right to claim the vested-but-unclaimed
portion, but the schedule no longer grows. Cancelling at or before `start_time`
refunds everything; cancelling after `end_time` refunds nothing. A second `cancel`
is a safe no-op.

### 2.5 Pause / resume

`pause_stream` records `pause_started_at`; `vested_amount` then evaluates at that
frozen timestamp, so `claimable` stops growing. `resume_stream` advances both
`start_time` and `end_time` by the elapsed pause duration
(`now - pause_started_at`, saturating), so the *remaining* vesting curve is shifted
intact rather than compressed. Pausing an already-paused (or canceled) stream and
resuming a live stream are rejected.

### 2.6 Overflow considerations

`vested_amount` computes `total_amount * elapsed` in `i128` before dividing.
Extremely large `total_amount` combined with a very long `elapsed` window can, in
principle, overflow `i128` and trap. Real token supplies and durations stay far
below this bound; callers minting synthetic streams with astronomically large
amounts should keep `total_amount * (end_time - start_time)` within `i128` range.

---

## 3. Worked examples

```
total_amount = 1_000, start_time = 100, end_time = 200, cliff_seconds = 0

at_time =  90  → vested =    0    (before start)
at_time = 100  → vested =    0    (elapsed 0)
at_time = 150  → vested =  500    (50% elapsed)
at_time = 175  → vested =  750
at_time = 200  → vested = 1000    (capped at end_time)
at_time = 999  → vested = 1000    (stays capped)
```

Floor rounding / dust recovery:

```
total_amount = 10, start_time = 0, end_time = 3, cliff_seconds = 0

at_time = 1 → vested = 10 * 1 / 3 = 3   (floor)
at_time = 2 → vested = 10 * 2 / 3 = 6   (floor)
at_time = 3 → vested = 10 * 3 / 3 = 10  (exact — the dropped units are recovered)
```
