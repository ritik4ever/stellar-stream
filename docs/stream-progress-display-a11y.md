# Stream Progress Display Accessibility Runbook (SSB-2026-053)

## Overview
This runbook specifies accessibility enhancements, timestamp boundary clamping, and tab visibility pause behaviors for the `Stream progress display` in `StreamDetailDrawer`.

## Specifications

### 1. Progress Bar Accessibility & Screen Reader Labeling
- The progress bar enforces `role="progressbar"` with semantic attributes:
  - `aria-valuenow`: Clamped between 0 and 100 (`Math.min(100, Math.max(0, percentComplete))`).
  - `aria-valuemin="0"` and `aria-valuemax="100"`.
  - `aria-valuetext`: Explicitly describes completion percentage, vested amount, and remaining amount (`"{pct}% complete, {vested} {asset} vested, {remaining} {asset} remaining"`).
- Polite live region (`data-testid="stream-progress-live-announcer"`) announces status updates without repetitive audio spam.

### 2. Boundary Timestamps & Label Associations
- Start and end boundary timestamps: When timestamps hit the absolute start or end, the progress percentage and remaining amounts clamp without negative values or rounding overflows.
- Descriptive labels: `Rate`, `Elapsed`, and `Remaining` rows enforce semantic `id` and `aria-labelledby` associations for screen reader clarity.

### 3. Tab Visibility (Page Visibility API)
- Listens to `visibilitychange` events on `document`:
  - When the browser tab is hidden, background polling/data re-fetching is suppressed.
  - When the user returns to the tab (`document.visibilityState === "visible"`), an automatic data refresh occurs.

## Verification
- Test suite: `frontend/src/components/StreamProgressDisplayA11y.test.tsx`
