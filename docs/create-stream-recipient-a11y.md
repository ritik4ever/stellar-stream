# Create Stream Recipient Keyboard & Screen Reader Accessibility Runbook (SSB-2026-013)

## Overview
This runbook covers accessibility (A11Y) implementations for the recipient input and the confirmation review step in `CreateStreamForm`.

## Specifications

### 1. Recipient Field Accessibility
- The recipient text field maps `aria-describedby` dynamically to `recipient-hint` or `recipient-error`.
- Account hints (`AccountHint`) employ `aria-live="polite"` so character count updates and key validity cues are communicated politely to assistive devices.
- Validation failures set `aria-invalid="true"` and render standard `role="alert"` messages.

### 2. Confirmation Review Step Semantics
- Both Sender and Recipient terms in `.fee-preview-list` map explicit descriptive labeling using `aria-labelledby` linked to corresponding `<dt>` elements (`review-sender-dt` and `review-recipient-dt`).
- Review action buttons (`Cancel`, `Confirm`, `Edit`, `Retry`) support complete keyboard activation via standard Enter/Space semantics.

## Verification
- Test suite: `frontend/src/components/CreateStreamRecipientA11y.test.tsx`
