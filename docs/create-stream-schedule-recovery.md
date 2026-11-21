# Create Stream Schedule Recovery Runbook (SSB-2026-007)

## Overview
This runbook documents recovery mechanisms for schedule and clock mismatch failures in `CreateStreamForm`.

## Specifications

### 1. Clock Skew & Timezone Recovery
- When RPC node or backend rejects scheduling with a clock skew or timestamp expiration error:
  - **Inline Fee Estimation Stage**: Displays an actionable error box with `Retry Estimation`. Re-attempting dynamically regenerates start and end timestamps against the current client timestamp, self-healing minor clock drifts.
  - **Confirmation Modal Stage**: Displays humanised `Device clock or timezone mismatch` guidance in the modal without closing the dialog. Provides `Retry Confirmation` to re-execute and `Edit` to return to form inputs.

### 2. State & Input Preservation
- All draft inputs (durations, offsets, amounts, addresses) remain fully preserved through draft autosave and component state.
- Idempotency guards (`isSubmitting` and `isConfirming`) eliminate race conditions and prevent duplicate submission dispatches.

## Verification
- Test suite: `frontend/src/components/CreateStreamScheduleRecovery.test.tsx`
