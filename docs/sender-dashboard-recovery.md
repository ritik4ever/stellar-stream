# Sender Dashboard Recovery Path

**Issue**: [#964 [UX] Add recovery path for Sender dashboard](https://github.com/ritik4ever/stellar-stream/issues/964)  
**Batch ID**: SSB-2026-022  
**Area**: `frontend`  
**Branch**: `feat/ssb-2026-022-sender-dashboard-recovery`

---

## Overview

This document describes the boundary behaviors and error-recovery semantics introduced in `SenderDashboard` as part of issue #964. The goal is to ensure that recoverable failures during stream operations result in actionable UI feedback—never silent failure, never destructive loss of user input.

---

## Boundary Conditions

### 1. Zero Streams

**Behavior (before and after this change — preserved)**:  
When a sender has no streams, the dashboard displays an empty-state prompt:

- **Card title**: "No Streams Found"  
- **CTA button**: "Create your first stream"  
- Metric cards (Total Streams Created, Active Streams, etc.) are **not rendered** in the zero-streams state.
- The chart and activity feed sections are conditionally hidden.

**How to verify**:  
```bash
# Render SenderDashboard with an address that returns an empty stream list
# → "No Streams Found" and "Create your first stream" are visible
# → No metric cards render
```

---

### 2. Very Large Stream Lists (150+ streams)

**Behavior**:  
Stream tables are wrapped in a container with:

```css
max-height: 480px;
overflow-y: auto;
```

This prevents the page from growing unboundedly and keeps the viewport stable.

**Key invariants**:
- All streams are still fetched and aggregated for metrics (count, total amount, status breakdowns).
- Scroll containment is applied to every section-level `div.table-wrap` element.
- The header checkbox (select-all) correctly selects all visible and non-visible streams.

**Test coverage**: The `reviews large stream list` test renders 150 streams and asserts:
- `Total Streams Created` metric card shows `150`
- `Active Streams` card shows `50`
- All `.table-wrap` elements have `maxHeight: 480px`

---

### 3. Recoverable Error on Dashboard Load

**Behavior**:  
When `listStreams` fails on initial or polled load, the dashboard renders an error card:

- **Title**: "Dashboard Load Failed"
- **Message**: The error message from the API response
- **Button**: "Retry" (`.retry-btn`) — re-triggers `loadStreams()` immediately
- **Guard**: A `isRetryingLoad` boolean prevents duplicate concurrent retries
- The retry does **not** reset any in-progress actions or wipe existing state

**Flow**:
```
loadStreams() fails
  → setError(msg)
  → Renders "Dashboard Load Failed" card with Retry button
  → User clicks Retry
  → isRetryingLoad = true (button disabled)
  → loadStreams() is called again
  → On success: error cleared, streams rendered
  → On failure: error updated, button re-enabled
```

---

### 4. Recoverable Error on Stream Cancellation (`handleCancel`)

**Behavior**:  
When a single stream cancel fails (HTTP error, timeout, transient gateway error):

- **In-flight guard**: `cancelingStreamId` is set to the stream's ID before the request. Any subsequent cancel or bulk cancel attempts are blocked until this resolves.
- **Error banner**: An `actionError` card appears with:
  - **Title**: "Cancellation Failed"
  - **Message**: The error message from the API
  - **Button**: "Retry Cancel" — re-invokes `handleCancel(streamId)` for only the failed stream
  - **Button**: "Dismiss" — clears the error banner without side effects
- **No duplicate action**: The in-flight guard (`cancelingStreamId !== null`) ensures a second cancel cannot be dispatched while the first is pending.
- **Safe input preservation**: The stream remains in its pre-cancel state; no optimistic update is applied.

---

### 5. Recoverable Error on Bulk Stream Cancellation (`handleBulkCancel`)

**Behavior**:  
When one or more streams in a bulk cancel batch fail:

- **Sequential execution**: Streams are cancelled one-by-one to allow partial success.
- **Partial failure tracking**: IDs of failed streams are collected in `failedIds[]`.
- **In-flight guard**: `isBulkCanceling` blocks concurrent bulk cancel or single cancel attempts.
- **Safe input preservation**: After the batch completes, `selectedStreamForBulkCancel` is updated to contain **only the failed IDs**. Successfully cancelled streams are removed from the selection.
- **Error banner**: An `actionError` card appears with:
  - **Title**: "Bulk Cancellation Failed"
  - **Message**: `${failedIds.length} of ${selectedIds.length} stream(s) could not be canceled: <lastErrorMsg>`
  - **Button**: "Retry Bulk Cancel" — re-invokes `handleBulkCancel()` with the preserved failed selection
  - **Button**: "Dismiss" — clears the error without altering the selection
- **Non-fatal refresh**: If the post-cancel `listStreams()` or `getSenderEvents()` refresh fails, it is silently swallowed (non-fatal). The UI state already reflects the partial success.
- **No duplicate action**: The `isBulkCanceling` guard prevents re-entrant requests.

**Example**:
```
Selected: [stream-A, stream-B, stream-C]
  stream-A → cancel OK
  stream-B → cancel FAIL (503 Transient gateway error)
  stream-C → cancel OK

Result:
  selectedStreamForBulkCancel = { stream-B }  ← preserved for retry
  actionError = {
    title: "Bulk Cancellation Failed",
    message: "1 of 3 stream(s) could not be canceled: Transient gateway error",
    action: "bulk_cancel"
  }

User clicks "Retry Bulk Cancel":
  handleBulkCancel() fires with { stream-B } selection
  stream-B → cancel OK (or fails again, same recovery applies)
```

---

## Component Changes

### `frontend/src/components/SenderDashboard.tsx`

| Feature | Implementation |
|---|---|
| `SenderDashboardActionError` interface | `{ title, message, action, streamId? }` |
| `cancelingStreamId` state | Prevents duplicate single-cancel requests |
| `isBulkCanceling` state | Prevents duplicate bulk-cancel requests |
| `isRetryingLoad` state | Prevents duplicate load-retry requests |
| `actionError` state | Drives the recoverable-error banner UI |
| `handleCreate` separation | Stream creation and dashboard refresh are decoupled; refresh failure does not re-trigger creation |
| `handleCancel` error banner | Actionable "Retry Cancel" / "Dismiss" buttons instead of `window.alert` |
| `handleBulkCancel` partial failure | Sequential cancel with failedIds tracking and safe selection preservation |
| Table scroll containment | `maxHeight: 480px; overflow-y: auto` on all `.table-wrap` containers |
| `onReconnect` prop | Optional callback rendered as "Connect Wallet" button in the wallet-not-connected state |

### `frontend/src/pages/SenderDashboard.tsx`

| Feature | Implementation |
|---|---|
| Load failure retry in page wrapper | Retry button re-invokes `loadStreams()` |
| `actionError` surfaced in dialogs | Action confirmation dialog preserves stream context and provides retry path |

---

## Test Coverage

File: `frontend/src/components/SenderDashboard.test.tsx`

New tests added for SSB-2026-022:

| Test | Scenario |
|---|---|
| `shows actionable Retry button when load fails and successfully recovers on retry` | Load failure → retry → success |
| `prevents duplicate requests during dashboard load retry` | Retry guard prevents concurrent retries |
| `shows reconnect wallet option when wallet is disconnected or onReconnect is provided` | `onReconnect` prop renders Connect Wallet button |
| `surfaces an actionable error banner and Retry Cancel button when stream cancellation returns a recoverable error` | Cancel failure → banner with retry → success |
| `preserves safe selection input and enables Retry Bulk Cancel when bulk cancellation encounters a recoverable error` | Partial bulk cancel → failed IDs preserved → retry only failed |
| `reviews large stream list: handles 150 streams correctly with aggregate stats and table scrolling` | 150-stream load → correct metrics, scrollable table |

**Total test count**: 20 tests, all passing.

---

## Acceptance Criteria Verification

| Criterion | Status |
|---|---|
| A simulated failure shows a useful message | ✅ Error banner with title + API error message |
| Retry works | ✅ Retry button re-invokes the failed operation |
| No duplicate action is sent | ✅ In-flight guards (`cancelingStreamId`, `isBulkCanceling`, `isRetryingLoad`) |
| Existing documented behavior preserved | ✅ Zero-stream, normal-flow, and large-list behaviors unchanged |
| Tests and documentation updated | ✅ 6 new tests, this doc created |
