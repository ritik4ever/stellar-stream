# Stream Progress Math Observability

**Batch ID**: SSB-2026-129  
**Area**: `backend`

This document specifies the observable telemetry and runbook procedures for Stream progress math calculations (`calculateProgress`), covering boundaries (before start, at start, at end) and system clock moving backwards.

---

## 1. Lifecycle Review & Boundaries

Stream progress calculation (`calculateProgress(stream, at)`) evaluates vesting state across lifecycle boundaries:

| Phase | Boundary Condition | Progress Math & Status | Operator Classification |
|---|---|---|---|
| **Before start** | `at < stream.startAt` | `status: "scheduled"`, `vestedAmount: 0`, `percentComplete: 0`, `elapsedSeconds: 0`. | **Normal empty case** (`isNormalEmpty: true`, `outcome: "success"` / code `0`). No failure or operator action. |
| **At start** | `at === stream.startAt` | `status: "active"`, `vestedAmount: 0`, `percentComplete: 0`, `elapsedSeconds: 0`. | Forward clock progression (`isNormalEmpty: false`, `outcome: "success"` / code `0`). |
| **Active vesting** | `startAt < at < end` | Linear vesting: `vestedAmount = totalAmount * (elapsed / duration)`. | Forward clock progression (`isNormalEmpty: false`, `outcome: "success"` / code `0`). |
| **At end / past end** | `at >= stream.startAt + durationSeconds + pausedDuration` | `status: "completed"`, `vestedAmount: totalAmount`, `percentComplete: 100`, `remainingAmount: 0`. | Forward clock progression (`isNormalEmpty: false`, `outcome: "success"` / code `0`). |
| **Paused** | `stream.pausedAt !== undefined` | `status: "paused"`, vesting frozen at `min(at, stream.pausedAt)`. | Forward clock progression (`isNormalEmpty: false`, `outcome: "success"` / code `0`). |
| **Canceled** | `stream.canceledAt !== undefined` | `status: "canceled"`, vesting frozen at `stream.canceledAt`. | Forward clock progression (`isNormalEmpty: false`, `outcome: "success"` / code `0`). |
| **Clock moving backwards** | `at < lastObservedAt` or `at < stream.createdAt` | `Math.max(0, ...)` prevents negative vesting math; structured signal & warning emitted. | **Clock skew failure** (`isNormalEmpty: false`, `outcome: "transient_delay"` or `"blocked"`). |

---

## 1.1 Consistency Rule: Vested Plus Remaining Equals Total (SSB-2026-128)

Across all lifecycle boundaries (before start, at start, active vesting, completed, paused, canceled) and under system clock movements (including transient clock skew or severe backwards clock jumps), stream progress math satisfies an exact conservation consistency rule:

$A_{vested} + A_{remaining} = A_{total}$

1. **Exact balance**: `vestedAmount` and `remainingAmount` are rounded and clamped such that `vestedAmount + remainingAmount === totalAmount` for any query timestamp `at` and across all HTTP endpoints returning stream progress.
2. **Lifecycle preservation**:
   - **Before start / normal empty**: `vestedAmount = 0`, `remainingAmount = totalAmount`.
   - **At start**: `vestedAmount = 0`, `remainingAmount = totalAmount`.
   - **At end / past end / completed**: `vestedAmount = totalAmount`, `remainingAmount = 0`.
   - **System clock backwards**: `vestedAmount` is safely floored at `0` (or frozen at cancellation/pause boundaries) and `remainingAmount` matches `totalAmount - vestedAmount`.
3. **Committed state guarantee**: Mutation handlers (`cancelStream`, `pauseStream`, `resumeStream`, `markStreamComplete`) and read operations reflect committed state on success, while any write or validation failure aborts the transaction and returns a stable error response without claiming an uncommitted state change.

---

## 2. Distinguishing Normal Empty Case from Clock Regression Failure

Before stream start (`at < stream.startAt`), zero vested amount and zero percentage complete is expected and healthy. Operators and automated alerting systems must distinguish this normal empty case from clock regression failures:

- **Normal Empty Case**:
  - `stream.createdAt <= at < stream.startAt`
  - `isNormalEmpty`: `true`
  - `outcome`: `"success"` (`outcomeCode: 0`)
  - `clockSkewSeconds`: `0`
  - Telemetry: No warning log emitted, Prometheus outcome gauge reports `0`.

- **System Clock Moving Backwards Failure**:
  - `at < stream.createdAt` or `at < lastObservedAt`
  - `isNormalEmpty`: `false`
  - `outcome`: `"transient_delay"` (for small backward jumps `<= 5s`) or `"blocked"` (for large backward jumps `> 5s` or `at < stream.createdAt`)
  - `clockSkewSeconds`: `> 0`
  - Telemetry: Structured warning log emitted with `event: "stream_progress_clock_skew"`, Prometheus gauge set to `1` or `2`, counter incremented.

---

## 3. Observable Signals & Telemetry

### 3.1 Prometheus Metrics

Exported via `/metrics` in `backend/src/services/metrics.ts`:

| Metric Name | Type | Description | Values / Labels |
|---|---|---|---|
| `stream_progress_outcome` | Gauge | Coarse progress calculation outcome | `0=success`, `1=transient_delay`, `2=blocked` |
| `stream_progress_clock_skew_seconds` | Gauge | Observed system clock backwards skew delta in seconds | Integer / Float seconds |
| `stream_progress_clock_skew_total` | Counter | Total number of system clock backwards events observed | Monotonic integer count |

### 3.2 Structured Logging

When the system clock moves backwards, `streamProgressOutcome` emits a structured warning log using `logger.warn()`:

```json
{
  "level": 40,
  "event": "stream_progress_clock_skew",
  "streamId": "34f191b2-c1ec-46da-a887-8df7d9d2fa07",
  "correlation_id": "784d2e9e-572f-4fbd-b508-e55c6a7fae5e",
  "outcome": "blocked",
  "outcomeCode": 2,
  "clockSkewSeconds": 45,
  "latencyMs": 1,
  "calculatedAt": 1792596000,
  "referenceAt": 1792596045,
  "isNormalEmpty": false,
  "msg": "System clock moved backwards by 45s (exceeds transient tolerance); operator action required to inspect clock synchronization."
}
```

### 3.3 Log Correlation & Linking

- **Request ID**: Linked automatically through `correlation_id` via `AsyncLocalStorage` context from incoming HTTP requests (`correlationContext.ts`).
- **Stream ID**: Explicitly linked via `streamId: stream.id`.
- **Search Query**: Operators can filter logs via `event = "stream_progress_clock_skew"` and correlate by `correlation_id` or `streamId`.

---

## 4. Privacy & Zero-Credential Redaction

In accordance with system security standards:
- **No Wallet Secret Keys**: Secret keys matching `^S[0-9A-Z]{55}$` are strictly prohibited and redacted by `logger.ts`.
- **No Private Keys / Seeds**: Fields like `secretKey`, `privateKey`, and `seed` are censored to `[REDACTED]`.
- **Minimal Surface**: Only identifiers (`streamId`, `correlation_id`), timestamps (`calculatedAt`, `referenceAt`), and numeric skews are logged.

---

## 5. Outcome Classification & Operator Actions

| Outcome | Code | Threshold / Condition | Meaning | Operator Action |
|---|---|---|---|---|
| `success` | 0 | `clockSkewSeconds === 0` | Forward clock, normal empty cases, active vesting, completed streams. | None. |
| `transient_delay` | 1 | `clockSkewSeconds <= 5` and `at >= stream.createdAt` | Small clock skew within NTP slew/adjustment tolerance. | None while transient delta clears. Monitor `stream_progress_clock_skew_seconds`. |
| `blocked` | 2 | `clockSkewSeconds > 5` or `at < stream.createdAt` | Severe clock regression or system time prior to stream creation. | Inspect NTP daemon status (`chrony`, `systemd-timesyncd`, `ntpd`), VM hypervisor clock synchronization, or hardware RTC. |

---

## 6. Verification & Clean-Room Testing

Run unit and boundary regression tests:

```bash
cd backend
npx vitest run src/services/streamStore.progress.test.ts src/services/streamProgressOutcome.test.ts
```

All boundary cases (before start, at start, at end, paused, canceled, clock regression, secret redaction, and metric updates) are validated.
