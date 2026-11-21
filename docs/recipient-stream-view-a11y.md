# Recipient Stream View Accessibility Runbook (SSB-2026-028)

## Overview
This runbook documents accessibility (WCAG 2.1 AA) and keyboard operation enhancements for the `Recipient stream view` in `RecipientDashboard`.

## Specifications

### 1. Keyboard-Only Navigation & Table Structure
- All active and completed stream tables enforce semantic `aria-label` attributes (`"Active streams"`, `"Completed streams"`).
- Table header cells (`<th>`) explicitly define `scope="col"` to provide clear context for screen reader row/column traversal.
- Focusable controls (Copyable Address, Claim Button, Claim All) follow logical tab order with visible high-contrast focus rings.

### 2. Recipient With No Claimable Streams
- When a recipient has active streams but zero claimable vested funds (`totalClaimable === 0`), a distinct status container (`data-testid="no-claimable-notice"`) is rendered:
  - Explains that funds have not vested yet.
  - Action button (`Claim all`) is cleanly disabled with descriptive `aria-label="No claimable streams to claim"`, preventing misleading trigger attempts.
  - Polite live region (`data-testid="recipient-status-announcer"`) announces the unvested state once without repetitive spam alerts.

### 3. Account Switching Mid-Request Safety
- If a user switches the active wallet address (`recipientAddress`) while a modal, batch fetch, or pending claim is open:
  - An address-bound effect cleanly closes `batchModalOpen`, wipes `pendingBatchInputs`, resets batch state, and clears old toasts.
  - Abort handling in `listRecipientStreams` prevents race conditions from rendering stale stream data from previous accounts.

## Verification
- Test suite: `frontend/src/components/RecipientStreamViewA11y.test.tsx`
