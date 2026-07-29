# Stream Math Reference

This document is the authoritative reference for StellarStream's vesting
math. It expands the formula summary in [README § 3](../README.md#3-stream-math-model)
with full derivations, concrete worked examples, and a catalogue of edge cases.

---

## Table of Contents

1. [Core Definitions](#1-core-definitions)
2. [Formula Derivations](#2-formula-derivations)
3. [Worked Examples](#3-worked-examples)
   - 3.1 [1 000 USDC over 1 Year — Claim at 6 Months](#31-1-000-usdc-over-1-year--claim-at-6-months)
   - 3.2 [1 000 USDC over 1 Year — Cancel at 9 Months](#32-1-000-usdc-over-1-year--cancel-at-9-months)
4. [Edge Cases](#4-edge-cases)
   - 4.1 [Claim Before Stream Starts](#41-claim-before-stream-starts)
   - 4.2 [Claim After Stream Ends](#42-claim-after-stream-ends)
   - 4.3 [Cliff Stream](#43-cliff-stream)
   - 4.4 [Instant Cancel (Cancel at t_start)](#44-instant-cancel-cancel-at-t_start)
   - 4.5 [Zero-Duration Guard](#45-zero-duration-guard)
5. [Status Rules Reference](#5-status-rules-reference)
6. [Implementation Cross-Reference](#6-implementation-cross-reference)

---

## 1. Core Definitions

| Symbol | Type | Description |
|---|---|---|
| $A_{total}$ | positive number | Total tokens locked into the stream at creation |
| $t_{start}$ | unix seconds | Timestamp at which vesting begins |
| $d$ | positive seconds | Duration of the stream in seconds |
| $t_{end}$ | unix seconds | Computed end timestamp: $t_{start} + d$ |
| $t$ | unix seconds | The current (or query) timestamp |
| $\Delta t$ | seconds | Clamped elapsed time within the vesting window |
| $R$ | $[0, 1]$ | Vesting ratio — fraction of total that has vested |
| $A_{vested}$ | number | Tokens that have vested as of time $t$ |
| $A_{remaining}$ | number | Tokens not yet vested as of time $t$ |
| $A_{claimed}$ | number | Tokens the recipient has already withdrawn |
| $A_{claimable}$ | number | $A_{vested} - A_{claimed}$ — withdrawable right now |

> **Note on units.** Token amounts in the Soroban contract are stored as
> `i128` with 7 decimal places (Stellar's standard stroops-like precision).
> The examples below use human-readable units (e.g. `1000 USDC`) for
> clarity. Multiply by `10^7` to get the on-chain integer representation.

---

## 2. Formula Derivations

### 2.1 Why clamp?

A naive ratio $R = (t - t_{start}) / d$ produces values outside $[0, 1]$
when queried before the stream starts ($t < t_{start}$, giving a negative
ratio) or after it ends ($t > t_{end}$, giving a ratio $> 1$). The clamp
ensures $R$ is always a valid fraction:

$$\Delta t = \max\!\bigl(0,\; \min(t - t_{start},\; d)\bigr)$$

- When $t \le t_{start}$: $t - t_{start} \le 0$, so $\max(0, \ldots) = 0$, giving $\Delta t = 0$.
- When $t \ge t_{end}$: $t - t_{start} \ge d$, so $\min(\ldots, d) = d$, giving $\Delta t = d$.
- When $t_{start} < t < t_{end}$: the raw elapsed time $t - t_{start}$ falls strictly in $(0, d)$ and passes through unchanged.

### 2.2 Vesting ratio

$$R = \frac{\Delta t}{d}$$

Because $\Delta t \in [0, d]$ and $d > 0$, we have $R \in [0, 1]$.

### 2.3 Vested amount

$$A_{vested} = A_{total} \times R = A_{total} \times \frac{\Delta t}{d}$$

This is a **linear (pro-rata)** vesting curve. Every second of elapsed stream
time releases exactly $A_{total} / d$ tokens.

### 2.4 Remaining and claimable

$$A_{remaining} = A_{total} - A_{vested}$$

$$A_{claimable} = A_{vested} - A_{claimed}$$

`A_claimable` is the net amount the recipient can withdraw right now.
It resets toward zero after each successful `claim()` call.

### 2.5 Cancel accounting

When a stream is canceled at time $t_{cancel}$:

$$A_{vested\_at\_cancel} = A_{total} \times \frac{\max(0,\; \min(t_{cancel} - t_{start},\; d))}{d}$$

The recipient retains $A_{vested\_at\_cancel}$ (minus what they have already
claimed). The sender is refunded $A_{total} - A_{vested\_at\_cancel}$.

$$A_{sender\_refund} = A_{total} - A_{vested\_at\_cancel}$$

---

## 3. Worked Examples

### 3.1 1 000 USDC over 1 Year — Claim at 6 Months

**Inputs**

| Parameter | Value |
|---|---|
| $A_{total}$ | 1 000 USDC |
| $t_{start}$ | `1_700_000_000` (Unix, ≈ Nov 2023) |
| $d$ | `31_536_000` s (365 days × 86 400 s/day) |
| $t_{end}$ | `1_731_536_000` |
| $t$ (query time) | `t_{start} + 15_768_000` (exactly 6 months = 182.5 days) |
| $A_{claimed}$ before this query | `0 USDC` |

**Step-by-step**

```
t            = 1_700_000_000 + 15_768_000
             = 1_715_768_000

Δt           = max(0, min(1_715_768_000 − 1_700_000_000, 31_536_000))
             = max(0, min(15_768_000, 31_536_000))
             = 15_768_000  s

R            = 15_768_000 / 31_536_000
             = 0.5  (exactly 50 %)

A_vested     = 1 000 × 0.5
             = 500 USDC

A_remaining  = 1 000 − 500
             = 500 USDC

A_claimable  = 500 − 0
             = 500 USDC
```

**Expected outputs**

| Field | Value |
|---|---|
| `vested` | `500 USDC` |
| `remaining` | `500 USDC` |
| `claimable` | `500 USDC` |
| `status` | `active` |

**After the recipient claims 500 USDC**

```
A_claimed    = 500 USDC
A_claimable  = 500 − 500 = 0 USDC
```

The stream remains `active`; the remaining 500 USDC continues to vest over
the next 6 months.

---

### 3.2 1 000 USDC over 1 Year — Cancel at 9 Months

Using the same stream as above, now assume:

- The recipient claimed **500 USDC** at the 6-month mark (example 3.1).
- The sender cancels at **9 months** (273.75 days = 23 652 000 s after start).

**Inputs**

| Parameter | Value |
|---|---|
| $A_{total}$ | 1 000 USDC |
| $t_{start}$ | `1_700_000_000` |
| $d$ | `31_536_000` s |
| $t_{cancel}$ | `t_{start} + 23_652_000` |
| $A_{claimed}$ | `500 USDC` (from 6-month claim) |

**Step-by-step**

```
Δt_cancel    = max(0, min(23_652_000, 31_536_000))
             = 23_652_000  s

R_cancel     = 23_652_000 / 31_536_000
             = 0.75  (exactly 75 %)

A_vested_at_cancel = 1 000 × 0.75
                   = 750 USDC

A_remaining_for_recipient = A_vested_at_cancel − A_claimed
                          = 750 − 500
                          = 250 USDC   ← recipient can still claim this

A_sender_refund = A_total − A_vested_at_cancel
                = 1 000 − 750
                = 250 USDC             ← returned to sender
```

**Expected outputs**

| Field | Value |
|---|---|
| `vested_at_cancel` | `750 USDC` |
| `recipient_claimable_after_cancel` | `250 USDC` |
| `sender_refund` | `250 USDC` |
| `status` | `canceled` |

**Accounting check**

```
A_claimed + A_remaining_for_recipient + A_sender_refund
= 500 + 250 + 250
= 1 000 USDC  ✓  (equals A_total, no tokens lost)
```

---

## 4. Edge Cases

### 4.1 Claim Before Stream Starts

**Scenario:** A stream is created with a future `t_start`; the recipient (or
anyone) queries the claimable amount before vesting begins.

**Inputs**

| Parameter | Value |
|---|---|
| $A_{total}$ | 500 USDC |
| $t_{start}$ | `1_800_000_000` (future timestamp) |
| $d$ | `86_400` s (1 day) |
| $t$ (now) | `1_799_990_000` (10 000 s before start) |

**Calculation**

```
Δt           = max(0, min(1_799_990_000 − 1_800_000_000, 86_400))
             = max(0, min(−10_000, 86_400))
             = max(0, −10_000)
             = 0  s

R            = 0 / 86_400 = 0

A_vested     = 500 × 0 = 0 USDC
A_claimable  = 0 USDC
```

**Expected outputs**

| Field | Value |
|---|---|
| `vested` | `0 USDC` |
| `claimable` | `0 USDC` |
| `status` | `scheduled` |

**Behaviour:** A `claim()` call at this point should be rejected by the
contract with `amount exceeds claimable` (claimable = 0). No funds move.

---

### 4.2 Claim After Stream Ends

**Scenario:** The recipient waits until after `t_end` to claim everything at
once (no intermediate claims).

**Inputs**

| Parameter | Value |
|---|---|
| $A_{total}$ | 200 USDC |
| $t_{start}$ | `1_700_000_000` |
| $d$ | `604_800` s (7 days) |
| $t_{end}$ | `1_700_604_800` |
| $t$ (now) | `1_701_000_000` (≈ 4.6 days after end) |
| $A_{claimed}$ | `0 USDC` |

**Calculation**

```
Δt           = max(0, min(1_701_000_000 − 1_700_000_000, 604_800))
             = max(0, min(1_000_000, 604_800))
             = 604_800  s   ← clamped to full duration

R            = 604_800 / 604_800 = 1.0

A_vested     = 200 × 1.0 = 200 USDC
A_claimable  = 200 − 0  = 200 USDC
```

**Expected outputs**

| Field | Value |
|---|---|
| `vested` | `200 USDC` |
| `claimable` | `200 USDC` |
| `status` | `completed` |

**Behaviour:** The clamp prevents `R` from exceeding 1.0, so the recipient
can claim exactly `A_total` — no more, no less. The stream status is
`completed` rather than `active`.

---

### 4.3 Cliff Stream

A **cliff** is a minimum vesting period during which `A_claimable` stays at
zero. Once the cliff is reached, all tokens vested up to that point become
claimable at once, and linear vesting continues from there.

> The cliff feature is **not yet in the core MVP contract**; it is planned
> for the next iteration. This section documents the intended math so that
> implementors have a clear target.

**Parameters (extended)**

| Symbol | Description |
|---|---|
| $c$ | Cliff duration in seconds (where $0 \le c \le d$) |
| $t_{cliff}$ | $t_{start} + c$ — timestamp at which cliff unlocks |

**Modified claimable formula**

```
if t < t_cliff:
    A_claimable_effective = 0          # cliff not yet reached
else:
    A_claimable_effective = A_vested − A_claimed
```

The underlying $A_{vested}$ computation is unchanged — vesting accrues
linearly from $t_{start}$ regardless of the cliff. The cliff only gates
*when* the recipient can withdraw.

**Worked example — 1 000 USDC, 1-year stream, 6-month cliff**

| Parameter | Value |
|---|---|
| $A_{total}$ | 1 000 USDC |
| $d$ | 31 536 000 s |
| $c$ | 15 768 000 s (6 months) |
| $t_{cliff}$ | $t_{start}$ + 15 768 000 |

Query at **month 3** ($t = t_{start} + 7\_884\_000$):

```
Δt       = 7_884_000 s   (3 months)
R        = 7_884_000 / 31_536_000 = 0.25
A_vested = 1 000 × 0.25 = 250 USDC

t < t_cliff → A_claimable_effective = 0 USDC
```

Query at **exactly month 6** ($t = t_{cliff}$):

```
Δt       = 15_768_000 s
R        = 0.5
A_vested = 500 USDC

t >= t_cliff → A_claimable_effective = 500 − 0 = 500 USDC
```

The recipient can instantly claim the full 6 months of accrued value. After
that, vesting continues at the normal linear rate.

**Expected outputs at cliff unlock**

| Field | Value |
|---|---|
| `vested` | `500 USDC` |
| `claimable` | `500 USDC` (all at once) |
| `status` | `active` |

---

### 4.4 Instant Cancel (Cancel at t_start)

**Scenario:** The sender cancels the stream immediately after creation,
before any vesting occurs.

**Inputs**

| Parameter | Value |
|---|---|
| $A_{total}$ | 1 000 USDC |
| $t_{start}$ | `T` |
| $d$ | `2_592_000` s (30 days) |
| $t_{cancel}$ | `T` (same second as start) |

**Calculation**

```
Δt_cancel    = max(0, min(T − T, 2_592_000))
             = max(0, 0)
             = 0  s

R_cancel     = 0 / 2_592_000 = 0

A_vested_at_cancel = 1 000 × 0  = 0 USDC
A_sender_refund    = 1 000 − 0  = 1 000 USDC
```

**Expected outputs**

| Field | Value |
|---|---|
| `vested_at_cancel` | `0 USDC` |
| `recipient_claimable_after_cancel` | `0 USDC` |
| `sender_refund` | `1 000 USDC` |
| `status` | `canceled` |

**Behaviour:** The full escrow is returned to the sender. The recipient
receives nothing because no time has elapsed.

---

### 4.5 Zero-Duration Guard

**Scenario:** A caller attempts to create a stream with `d = 0`.

Division by zero in $R = \Delta t / d$ would produce `NaN` or a runtime
panic.

**Guard rule:** The API layer (and the contract) reject any stream where
`durationSeconds < 60` (the minimum enforced by POST `/api/streams`
validation). The contract itself should additionally assert `end_time >
start_time` before persisting state.

```
POST /api/streams  { durationSeconds: 0 }
→ 400 Bad Request: "duration must be at least 60 seconds"

POST /api/streams  { durationSeconds: 30 }
→ 400 Bad Request: "duration must be at least 60 seconds"
```

No math is ever applied to a zero-duration stream.

---

## 5. Status Rules Reference

| Status | Condition | Notes |
|---|---|---|
| `scheduled` | $t < t_{start}$ | Stream exists but vesting has not started |
| `active` | $t_{start} \le t < t_{end}$ | Vesting in progress; $R \in (0, 1)$ |
| `completed` | $t \ge t_{end}$ | Full amount vested; $R = 1$ |
| `canceled` | Explicit `cancel()` call | Frozen at $A_{vested\_at\_cancel}$; no further vesting |

A `canceled` stream retains its `vested_at_cancel` snapshot. The recipient
may still claim any unclaimed portion of that vested amount; the sender
receives the remainder.

---

## 6. Implementation Cross-Reference

| Concept | Backend location | Contract location |
|---|---|---|
| `Δt` clamp | `backend/src/services/streamStore.ts` | `contracts/src/lib.rs` → `claimable()` |
| `R` and `A_vested` | `streamStore.ts` `computeProgress()` | `claimable()` return value |
| `A_claimable` | `streamStore.ts` `computeProgress()` | `claimable()` |
| Cancel accounting | `streamStore.ts` `cancelStream()` | `cancel()` |
| Status derivation | `streamStore.ts` `deriveStatus()` | not stored on-chain (derived client-side) |
| Duration guard | `backend/src/index.ts` validation | `create_stream()` assertion |

For TypeScript binding signatures of `claimable()`, `claim()`, and
`cancel()`, see [CONTRACT_BINDINGS.md](./CONTRACT_BINDINGS.md).
