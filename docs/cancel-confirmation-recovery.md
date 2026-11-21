# Cancel Confirmation Timeout Recovery Path (SSB-2026-067)

## Overview
This document specifies the fault recovery workflow implemented for the Cancel confirmation flow in `SenderDashboard.tsx` when cancel submissions encounter network timeouts, RPC drops, or delayed responses from Horizon/Soroban.

---

## 1. Problem Addressed
When a sender initiates stream cancellation and the transaction request times out, terminating with an unhandled exception or leaving the user with ambiguous state risks duplicate cancellation attempts, double-spend warnings, or confusing UI state.

---

## 2. Recovery Workflow Architecture

1. **Timeout & Failure Detection:**
   - Detects network timeouts, HTTP 504 gateway timeouts, and abort exceptions during `cancelStream()`.
   - Distinctly labels the error header as `Cancel Request Timed Out` rather than generic failure.
   - Explains clearly that stream parameters are preserved and that the sender can safely retry.

2. **In-Flight Concurrency Guard:**
   - `confirmCancelStream()` enforces an in-flight check (`if (!id || cancelingStreamId !== null || isBulkCanceling) return;`).
   - The retry control sets `aria-busy="true"`, transitions to `Retrying…`, and disables the button during execution.
   - Ensures no duplicate cancellation transactions are dispatched even if users click repeatedly.

3. **State Resynchronization upon Recovery:**
   - On successful retry, streams and event streams are refreshed.
   - The error box (`actionError`) is cleared cleanly.
   - Live region notification announces successful completion to assistive technologies.

---

## 3. Verification
- **Test File:** `frontend/src/components/CancelConfirmationRecovery.test.tsx`
- **Coverage:**
  - Validates display of `Cancel Request Timed Out` alert card upon simulated network timeout.
  - Verifies `Retry Cancel` button successfully triggers re-submission.
  - Confirms zero duplicate actions sent across retry lifecycle.
  - Verifies safe error dismissal without side effects.
