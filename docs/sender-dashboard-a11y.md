# Sender Dashboard — Keyboard & Screen Reader Accessibility

**Issue**: [#965 [A11Y] Make Sender dashboard operable with keyboard and screen reader](https://github.com/ritik4ever/stellar-stream/issues/965)  
**Batch ID**: SSB-2026-023  
**Area**: `frontend`  
**Branch**: `feat/ssb-2026-023-sender-dashboard-a11y`

---

## Overview

This document describes all accessibility (A11Y) improvements made to the Sender Dashboard as part of issue #965. The changes are WCAG 2.1 AA-aligned and ensure that every interaction is operable by keyboard alone and that status changes are announced to screen readers without disruptive repeated alerts.

---

## Changes — `frontend/src/components/SenderDashboard.tsx`

### 1. Accessible Cancel Confirmation Modal (replaces `window.confirm`)

`window.confirm` is not reliably operable by AT (assistive technology). It was replaced with an in-page `role="dialog"` modal that:

- Has `aria-labelledby="cancel-confirm-title"` tied to the `<h3>` title
- Has `aria-modal="true"` to restrict AT browsing to the modal
- Receives focus automatically when opened (first focusable element)
- Returns focus to the triggering element when closed
- Is closable via **Escape** key
- Has a focus trap: `Tab`/`Shift+Tab` cycles only within the panel
- Buttons: **"Keep stream"** (dismiss) and **"Yes, cancel stream"** (confirm)

The same focus-trap and restore logic is applied to the **Bulk Cancel** confirmation modal.

### 2. Accessible Bulk Cancel Confirmation Modal

Replaces the `window.confirm` in `handleBulkCancel` with an equivalent `role="dialog"` modal:

- `aria-labelledby="bulk-cancel-confirm-title"` with stream count in the title
- Same focus-trap, Escape-to-close, and focus-restore semantics
- Confirm button: `"Yes, cancel N stream(s)"`

### 3. `aria-live` Polite Region for Status Announcements

A visually-hidden `role="status" aria-live="polite" aria-atomic="true"` element is added at the root of the component. Stream action outcomes are announced through it:

| Event | Announcement |
|---|---|
| Single stream cancel success | `"Stream <id> canceled successfully."` |
| Single stream cancel failure | `"Cancellation failed: <reason>"` |
| Bulk cancel all success | `"All N stream(s) canceled successfully."` |
| Bulk cancel partial failure | `"Bulk cancel: N of M stream(s) could not be canceled."` |

This satisfies **WCAG 4.1.3 Status Messages** (Level AA) — status changes are announced without requiring focus, without repeated intrusive alerts.

### 4. Table Column Headers — `scope="col"`

All `<th>` elements in the Active & Scheduled and History tables now carry `scope="col"`. This tells screen readers how to associate data cells with their column, satisfying **WCAG 1.3.1 Info and Relationships**.

Both tables also have `aria-labelledby` pointing to their section heading and unique heading `id` attributes.

### 5. Truncated Addresses — `title` + `aria-label`

Address `<span class="truncate-address">` elements now carry:
- `title="<full address>"` — hover tooltip with full value  
- `aria-label="Recipient: <full address>"` — full address announced by screen readers

Affects both the Active & Scheduled table and the History table.

### 6. Select-All Checkbox — Indeterminate State

The header checkbox now uses a `ref` callback to set `el.indeterminate = true` when some (but not all) streams are selected. This satisfies **WCAG 1.3.1** by visually and programmatically conveying the mixed/partial selection state.

The `aria-label` also dynamically switches between `"Select all streams"` and `"Deselect all streams"` based on the current state.

### 7. Progress Bar — `aria-label`

The `.progress-copy` div now carries `aria-label="${percent}% complete"` so screen readers announce the meaningful percentage. The visual `.progress-bar` remains `aria-hidden`.

### 8. Cancel Button — Descriptive `aria-label`

Each row's Cancel button now has `aria-label="Cancel stream to <truncated recipient>"` so screen readers announce which stream will be cancelled, not just "Cancel".

Similarly, Pause/Resume buttons in `pages/SenderDashboard.tsx` carry descriptive `aria-label` attributes.

### 9. Chart Section — Screen Reader Summary

The bar chart (`BarChart`) is wrapped in `aria-hidden="true"`. A visually-hidden `<p class="sr-only">` immediately before the chart provides a text summary: e.g., `"Active: 3, Scheduled: 1, Completed: 2"`.

### 10. Metric Cards — `aria-labelledby`

Each `<article class="metric-card">` now has matching `id` on the label `<span>` and `aria-labelledby` on the `<strong>` value, so screen readers announce `"Total Streams Created: 4"` as a coherent unit.

### 11. `aria-pressed` on Toggle Button

The "Create Stream" / "Back to Dashboard" toggle button now has `aria-pressed={showCreateForm}` so screen readers know the toggle state.

### 12. Activity Feed — `role="list"` / `role="listitem"`

The activity feed `div` is marked `role="list"` with individual event items as `role="listitem"`. Timestamps are wrapped in `<time>` elements. Stream IDs in event items carry `title` and `aria-label` with the full stream ID.

---

## Changes — `frontend/src/pages/SenderDashboard.tsx`

### 1. Modal Focus Management (focus trap + restore)

The existing action confirmation modal (`pause`/`resume`/`cancel`) now:
- Stores the triggering element in a `triggerRef` on open, restores focus on close
- Traps Tab/Shift+Tab within the modal panel
- Closes on **Escape** key
- Has `aria-labelledby="confirm-dialog-title"` linked to `id="confirm-dialog-title"` on the `<h3>`
- Removes the erroneous `aria-hidden="false"` from the backdrop

### 2. Live Region for Action Outcomes

Same `role="status" aria-live="polite"` region added. `runAction` calls `announce()` on success and failure.

### 3. Table `scope="col"` + `aria-labelledby`

`renderTable` now accepts a `tableId` parameter and applies:
- `scope="col"` to all `<th>` elements
- `aria-labelledby={tableId + "-heading"}` on the `<table>`
- `id={tableId + "-heading"}` on the `<h3>` section heading

### 4. Descriptive Button `aria-label` on Action Buttons

Pause, Resume, and Cancel buttons in `renderStreamRow` carry `aria-label` naming the recipient, e.g.:
`"Cancel stream to GABCD…1234"`

### 5. Truncated Addresses — `title` + `aria-label`

Same fix as in the component file.

### 6. Progress — `aria-label`

Same fix as in the component file.

---

## Focus Order

The logical focus order is preserved and follows the visual document order:
1. Dashboard header / Create Stream button
2. Error banner (if present) → Retry / Dismiss
3. Metric cards (not focusable — informational)
4. Streams table: Select-all checkbox → row checkboxes → Edit / Cancel buttons
5. Quick Actions: Bulk Cancel button
6. Modal (when open): modal title announced → Close ✕ → Keep / Confirm buttons

---

## Test Coverage

File: `frontend/src/components/SenderDashboard.test.tsx`

New A11Y tests (SSB-2026-023):

| Test | Scenario |
|---|---|
| `opens accessible cancel confirmation dialog instead of window.confirm when Cancel is clicked` | Dialog role, labelledby, keyboard-operable buttons |
| `closes cancel dialog with Escape key (keyboard operability)` | Escape key dismisses dialog |
| `opens accessible bulk cancel confirmation dialog with correct count in title` | Bulk cancel dialog role, labelledby, stream count |
| `table headers have scope=col for screen reader column association` | All `<th>` elements carry `scope="col"` |
| `select-all checkbox shows indeterminate state when partially selected` | Indeterminate DOM property set correctly |
| `truncated recipient addresses carry title and aria-label with full address` | Full address in `title` and `aria-label` |
| `renders a polite aria-live region for screen reader announcements` | `role="status"`, `aria-live="polite"`, `aria-atomic="true"` present |

**Total test count**: 27 tests, all passing.

---

## Acceptance Criteria Verification

| Criterion | Status |
|---|---|
| Keyboard-only completion works | ✅ Tab order, Escape to close, focus trap in modals, all buttons reachable |
| Screen reader announces changed status without repeated alerts | ✅ `aria-live="polite"` region announces outcomes once; no `window.alert` or `window.confirm` |
| Existing documented behavior preserved | ✅ Zero-stream, error recovery, and large-list behaviors unchanged |
| Tests and documentation updated | ✅ 7 new A11Y unit tests, this doc created |
