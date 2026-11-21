# Claim Preview Accessibility (SSB-2026-063)

## Overview
This document specifies the accessibility (a11y) and keyboard navigation enhancements made to the `ClaimBatchModal` component to satisfy WCAG 2.1 AA criteria.

## Requirements Addressed
1. **Keyboard-Only Operation & Escape Key Handling:**
   - Active focus trap via `useFocusTrap` confines keyboard tab navigation inside the modal panel while open.
   - Global `Escape` key event listener allows users to dismiss the preview modal from the keyboard safely when no transaction is actively in-flight (`!isClaiming`).

2. **Polite Screen Reader Announcements (`aria-live="polite"`):**
   - Implemented an accessible live region (`role="status"`, `aria-live="polite"`, `data-testid="claim-a11y-announcer"`).
   - Dynamically announces state transitions (ready preview with claimable amounts, in-flight claiming progress, completion metrics, and errors) without repeating disruptive alerts.

3. **Accessible Dialog Semantics & Field Descriptors:**
   - The modal container specifies `role="dialog"`, `aria-modal="true"`, `aria-labelledby="claim-batch-title"`, and `aria-describedby="claim-batch-summary"`.
   - Failure lists include `aria-label="Failed stream claims"`.
   - All interactive controls enforce minimum 44px by 44px dimensions to support accessible mobile touch targets.

## Verification
- Unit test suite: `frontend/src/components/ClaimPreviewA11y.test.tsx`
- Verifies keyboard escape dismissal, live region announcements, focus trapping, and accessible button labels.
