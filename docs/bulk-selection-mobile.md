# Bulk Selection Mobile and Narrow Screen Runbook (SSB-2026-074)

## Overview
This runbook documents the mobile usability, touch-target compliance, and partial failure handling for the Bulk Selection workflow in `SenderDashboard.tsx`.

## Responsive Architecture
1. **Narrow Viewport (320px & 768px)**:
   - The Quick Actions bulk toolbar wraps cleanly on mobile devices without container clipping.
   - The Bulk Cancel button is styled with `minHeight: 44px` to meet WCAG 2.5.5 / 2.5.8 touch target standards.
2. **Partial Batch Failure Handling**:
   - If individual operations in a batch fail (e.g. one stream cancellation times out while others succeed), the dashboard reports the exact partial failure count (`X of Y stream(s) could not be canceled: <error>`).
   - The failed stream IDs remain selected in the selection set, allowing one-click retry without re-selecting items.
3. **Table Column Usability**:
   - Long 56-character account IDs and amounts inside table rows wrap within responsive horizontal containers (`.table-wrap`) to prevent forced page breaks.

## Verification
- Unit test suite: `frontend/src/components/BulkSelectionMobile.test.tsx`.
