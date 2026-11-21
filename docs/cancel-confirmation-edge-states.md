# Cancel Confirmation Edge and Failure States Specification (SSB-2026-070)

## Overview
This document specifies the test coverage and behavioral assertions for the `Cancel confirmation` workflow in `SenderDashboard.tsx`, verifying boundary distinctions between active and already canceled streams and error recovery when cancel submissions time out, using isolated synthetic mocks without live network or testnet dependencies.

---

## 1. Boundary Behavior: Already Canceled vs. Active Streams

### Active Streams
- **Visible State:**
  - Dialog title: `Cancel stream?` (`data-testid="cancel-modal-title"`).
  - Irreversible action description with dynamic refundable calculation: `data-testid="cancel-refundable-amount"`.
  - Primary button: Enabled, destructive red button `Yes, cancel stream` (`data-testid="cancel-confirm-btn"`).
  - Dismiss button: `Keep stream` (`data-testid="cancel-dismiss-btn"`).
- **Safe Action Behavior:**
  - Triggering `Yes, cancel stream` submits a single cancellation request to `/api/streams/:id/cancel`.
  - Upon success, dashboard stream list and activity events refresh immediately.

### Already Canceled / Completed Streams
- **Visible State:**
  - Dialog title: `Stream already canceled` or `Stream already completed`.
  - Explicit boundary banner: `data-testid="cancel-boundary-notice"` (`role="status"`) explaining that the stream has already terminated and unvested funds were refunded.
  - Primary action: Disabled non-actionable badge labeled `Already canceled` (`aria-disabled="true"`), preventing misleading click targets.
  - Dismiss action: Safe `Close` button.
- **Safe Action Behavior:**
  - Clicking the disabled primary badge triggers zero network requests.
  - Clicking `Close` dismisses the dialog safely without side effects.

---

## 2. Failure State: Cancel Submission Timing Out

### Gateway & RPC Timeouts
- **Visible State:**
  - When `cancelStream()` encounters a network drop or gateway timeout (HTTP 504), an alert box (`data-testid="cancel-error-box"`) appears.
  - Header distinctly indicates `Cancel Request Timed Out` (`data-testid="cancel-error-title"`).
  - Body text informs the user that cancellation timed out and stream details have been preserved.
  - Action controls include `Retry Cancel` (`data-testid="cancel-retry-btn"`) and `Dismiss` (`data-testid="cancel-dismiss-error-btn"`).
- **Safe Action Behavior:**
  - Triggering `Retry Cancel` dispatches a single retry request.
  - In-flight lock guards against duplicate submissions (`aria-busy="true"`, button disabled during retries).
  - Successful retry clears the error banner and reflects canceled status across the dashboard.
  - Dismiss button removes the error card without re-dispatching actions.

---

## 3. Verification
- **Test File:** `frontend/src/components/CancelConfirmationEdgeStates.test.tsx`
- **Criteria Verified:**
  - Visible active stream confirmation and safe dispatch.
  - Visible boundary banner and inert button for already finalized streams.
  - Visible timeout recovery card and safe single-dispatch retry.
  - Complete execution using MSW mock handlers without live testnet calls.
