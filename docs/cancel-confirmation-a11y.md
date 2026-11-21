# Cancel Confirmation Accessibility Runbook (SSB-2026-068)

## Overview
This runbook documents the accessible keyboard navigation, screen-reader announcements, and status handling for the Cancel Stream confirmation modal.

## Accessibility Architecture
1. **Semantic Dialog Roles**:
   - The confirmation modal uses `role="dialog"`, `aria-modal="true"`, `aria-labelledby="cancel-confirm-title"`, and `aria-describedby="cancel-confirm-desc"`.
2. **Refundable Amount & Irreversible Warning**:
   - Prominently informs the user of the exact unvested balance refundable to the sender (`Refundable to sender: <amount> <asset>`).
   - Clearly flags the cancellation as an irreversible action that terminates token emission.
3. **Already Canceled Streams**:
   - Enforces a guard preventing duplicate cancellation requests on streams that have already transitioned to `canceled` or `completed`.
4. **Keyboard-Only Operability**:
   - Supports seamless `Escape` dismissal and keyboard activation on `Keep stream` and `Yes, cancel stream` buttons.

## Verification
- Unit test suite: `frontend/src/components/CancelConfirmationA11y.test.tsx`.
