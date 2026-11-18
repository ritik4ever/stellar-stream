# Create Stream Recipient Recovery Runbook (SSB-2026-012)

## Overview
This runbook documents recovery workflows for wallet disconnection and account switching edge cases during recipient specification and stream confirmation in `CreateStreamForm`.

## Specifications

### 1. Changed Wallet Recovery
- When a user changes their active wallet public key during the review/confirmation step:
  - Form intercepts the attempt with the actionable alert:
    `Connected wallet does not match the stream sender. Please switch back to the original account.`
  - The confirmation modal remains open in an alert state with `Retry Confirmation` and `Edit`.
  - Reconnecting the original sender address enables immediate retry execution without re-entering form data.

### 2. Disconnection & Edit Fallback
- If the wallet disconnects, an explicit `Wallet disconnected` error is displayed.
- The `Edit` action safely dismisses the confirmation modal, returning to the form with all entered parameters (recipient account, amount, durations) fully preserved.

### 3. Idempotency & Action Debouncing
- `isConfirming` locks submission buttons during asynchronous dispatch, preventing race conditions or duplicate network calls.

## Verification
- Test suite: `frontend/src/components/CreateStreamRecipientRecovery.test.tsx`
