# Sender Dashboard Boundary States Runbook (SSB-2026-021)

## Overview
This runbook specifies boundary state handling, empty state clarity, and large stream volume UI behavior for `SenderDashboard`.

## Specifications

### 1. Zero Streams Boundary State
- When an account has zero associated streams (`streams.length === 0`), `SenderDashboard` renders a dedicated empty state (`data-testid="sender-zero-streams"`):
  - Displays "No Streams Found" with explanatory copy.
  - Primary call-to-action is "Create your first stream", guiding users straight into the stream creation flow.
  - Gated controls: Bulk actions, table headers, and batch cancel buttons are completely omitted to avoid misleading ready-to-act controls when no streams exist.

### 2. Large Stream Lists
- When stream lists scale up (e.g. $\ge 50$ streams), an explicit status badge (`data-testid="large-stream-list-badge"`) marks the list as "Large Volume ({count})".
- The active/scheduled streams list is enclosed in a bounded scrolling container (`max-height: 480px`, `overflow-y: auto`), preventing layout blowout and page scroll jank.
- Bulk cancel actions remain strictly gated: the bulk cancel trigger button is only displayed when at least one stream is selected (`selectedStreamForBulkCancel.size > 0`).

### 3. Recoverable Error State
- When stream queries fail due to network or server issues, `SenderDashboard` presents an accessible error card (`className="activity-error"` with `role="alert"`).
- Contains explicit error descriptions, a prominent "Retry" button (`className="retry-btn"`), and an optional wallet reconnect action.

## Verification
- Test suite: `frontend/src/components/SenderDashboardBoundary.test.tsx`
