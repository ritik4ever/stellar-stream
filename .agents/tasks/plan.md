# Implementation Plan: Add Recovery Path for Create Stream Amount Workflow (SSB-2026-002)

## Context

**Current behavior confirmed from code:**
- `CreateStreamForm.tsx` shows `simulationError` when fee estimation fails, but provides no retry mechanism.
- Form state is preserved via `useDraftAutosave` hook, but submission error handling doesn't preserve form values.
- `isSubmitting` flag prevents duplicate submissions during fee estimation, but NOT during the confirmation phase after the fee preview modal opens.
- When `onCreate()` rejects, `simulationError` is set and modal remains open, but there's no retry button.
- Form submission errors (from the backend) are converted to human-readable messages via `humaniseApiError()`, but no actionable recovery path exists.
- No balance validation exists before submission; stale balance is not checked before the user clicks "Create Stream".

**Problem areas identified:**
1. **Stale balance:** No pre-submission balance check. If wallet balance changes between form fill and submit, the backend rejects it with an error message, but the user must manually refresh and re-enter data.
2. **Rejected submit (fee estimation or stream creation):** When `estimateCreateStreamFee()` or `onCreate()` fails, the form shows an error but provides no clear retry button or path to re-attempt with the same data.
3. **Duplicate submission:** The confirmation phase (`confirmCreateStream`) sets `isSubmitting = true` but the confirmation button can still be clicked during pending confirmation, risking duplicate transactions.

## Design Decisions

### 1. Stale Balance Detection (Not Implemented Here—Marked as Future Work)
**Decision:** Do not add live wallet balance querying in this iteration.
**Rationale:** The task scope is scoped to "recovery path for stale balance or rejected submit." Without a wallet balance API endpoint (which would require backend changes), we cannot reliably detect stale balance before submission. We can surface it reactively when the backend rejects the submission. A future iteration should add a `getWalletBalance()` API and a pre-submission check hook.

### 2. Rejected Submit Recovery Path
**Decision:** Add a retry button that appears when fee estimation OR stream creation fails, preserving form input and preventing duplicate submissions.
**Rationale:** 
- Form state is already persisted via `useDraftAutosave`, so input is not lost.
- The error message (`simulationError`) already appears inline, so users see the failure.
- Adding a distinct "Retry" button makes the recovery path explicit and actionable.
- An in-flight guard on the confirmation button prevents double-clicks during submission.

### 3. Error Messaging
**Decision:** Enhance error messages to distinguish between stale balance (reactive, from backend rejection) and other failures (network, RPC, transaction rejection).
**Rationale:** Users need to know what went wrong and why. The existing `humaniseApiError()` function already maps backend errors to friendly titles and hints. We'll leverage that and ensure error messages hint at the fix (e.g., "Check your balance and retry").

### 4. Modal Behavior
**Decision:** Keep the fee preview modal open on confirmation error, with a prominent retry button and a close button to go back and edit.
**Rationale:** The modal is the "point of no return"—users should see the exact amounts before committing. If confirmation fails, they should retry at that same confirmation step without losing their fee preview data.

## Implementation Plan

### Phase 1: Prevent Duplicate Submissions

- [ ] **Item 1. Add in-flight guard to confirmation phase in CreateStreamForm.tsx**
      
      Add a new state flag `isConfirming` that is distinct from `isSubmitting`. When `confirmCreateStream()` begins, set `isConfirming = true` immediately; disable the confirmation button while true. This prevents double-clicks on "Confirm" before the first `onCreate()` call completes.
      
      **Rationale:** Currently, `isSubmitting` is set during fee estimation and confirmation, but not atomically. A dedicated flag ensures the confirmation button cannot be clicked twice.
      
      **Files to modify:** 
      - `frontend/src/components/CreateStreamForm.tsx`
      
      **Verify:** Run `npm run test` in the `frontend` directory and confirm that existing tests still pass.

### Phase 2: Add Explicit Retry Path for Fee Estimation Failures

- [ ] **Item 2. Add "Retry" button for fee simulation errors in CreateStreamForm.tsx**
      
      When `simulationError` is set and the fee preview modal is NOT open (i.e., fee estimation failed), display a "Retry Estimation" button next to the error message. Clicking it re-runs `handleSubmit()` with the current form values, preserving input.
      
      **Rationale:** Fee estimation failures are transient (network, RPC timeouts). A retry button surfaces the recovery path explicitly. Form input is already preserved by `useDraftAutosave`, so re-running the submit handler will use the same values.
      
      **Files to modify:**
      - `frontend/src/components/CreateStreamForm.tsx`
      
      **Verify:** Run `npm run test` in the `frontend` directory and confirm that existing tests still pass.

### Phase 3: Add Explicit Retry Path for Stream Creation Failures

- [ ] **Item 3. Add "Retry" and "Edit" buttons for submission errors in CreateStreamForm.tsx modal**
      
      When `feePreview` is open and `simulationError` is set (stream creation failed), hide the "Confirm" button and show two buttons instead:
      - **"Retry Confirmation"**: Re-runs `confirmCreateStream()` with the same fee preview data.
      - **"Edit"**: Closes the modal, returns to form editing, and keeps the form input intact.
      
      The "Retry Confirmation" button is disabled while `isConfirming = true` to prevent double submissions.
      
      **Rationale:** Stream creation failures may also be transient. Users should be able to retry without losing the fee preview. If they need to adjust inputs (e.g., due to stale balance feedback), they can click "Edit" to go back.
      
      **Files to modify:**
      - `frontend/src/components/CreateStreamForm.tsx`
      
      **Verify:** Run `npm run test` in the `frontend` directory and confirm that existing tests still pass.

### Phase 4: Add Test Coverage for Recovery Paths

- [ ] **Item 4. Add unit tests for retry behavior in CreateStreamForm.test.tsx**
      
      Add three new test cases:
      
      1. **"Fee estimation retry: clicking 'Retry Estimation' re-runs fee estimation with same input"**
         - Setup: Mock `estimateCreateStreamFee` to fail once, then succeed on retry.
         - Action: Fill form, click "Create Stream", see error, click "Retry Estimation".
         - Expect: `estimateCreateStreamFee` is called twice; fee preview appears after retry.
      
      2. **"Confirmation retry: clicking 'Retry Confirmation' re-runs stream creation with same data"**
         - Setup: Mock `estimateCreateStreamFee` to succeed, mock `onCreate` to fail once, then succeed on retry.
         - Action: Fill form, confirm fee preview, see error in modal, click "Retry Confirmation".
         - Expect: `onCreate` is called twice; modal closes and form is cleared after retry.
      
      3. **"Edit from confirmation: clicking 'Edit' closes modal and preserves form input"**
         - Setup: Mock `estimateCreateStreamFee` to succeed, mock `onCreate` to fail.
         - Action: Fill form, confirm fee preview, see error, click "Edit".
         - Expect: Modal closes; form still contains the original input values.
      
      **Rationale:** These tests ensure that the recovery paths work as designed and that form state is preserved correctly across retry scenarios.
      
      **Files to modify:**
      - `frontend/src/components/CreateStreamForm.test.tsx`
      
      **Verify:** Run `npm run test -- src/components/CreateStreamForm.test.tsx` and confirm all new tests pass.

### Phase 5: Update Inline Documentation

- [ ] **Item 5. Add JSDoc comments to CreateStreamForm explaining the recovery flow**
      
      Add or update JSDoc comments to the component and key functions:
      - Explain how form state is preserved via `useDraftAutosave`.
      - Document the retry button behavior for fee estimation failures.
      - Document the "Retry Confirmation" and "Edit" button behavior in the fee preview modal.
      - Note that stale balance is detected reactively (backend rejects submission) and users should check their balance and retry.
      
      **Rationale:** Clear documentation helps maintainers understand the recovery UX design and prevents accidental regressions.
      
      **Files to modify:**
      - `frontend/src/components/CreateStreamForm.tsx` (add JSDoc comments)
      
      **Verify:** No test needed; review comments for clarity and accuracy.

### Phase 6: Verify Full Workflow

- [ ] **Item 6. Manual integration test: run the full create stream workflow with simulated failures**
      
      Setup:
      - Start the frontend dev server: `npm run dev` (in `frontend` directory).
      - Start the backend API server (if running locally) or use mocked API responses via `vi.mock()`.
      
      Scenario 1 - Stale balance / rejected submit:
      - Fill the form with valid data.
      - Click "Create Stream"; fee estimation succeeds, modal opens.
      - Mock the API to reject the `onCreate` call with a "Insufficient balance" error.
      - Confirm; see error in modal.
      - Click "Retry Confirmation"; confirm again.
      - Verify that `onCreate` is called twice and no duplicate transaction is sent (check request logs).
      - Click "Edit"; verify form input is still present.
      
      Scenario 2 - Transient fee estimation failure:
      - Fill the form with valid data.
      - Mock `estimateCreateStreamFee` to fail once.
      - Click "Create Stream"; see error message.
      - Click "Retry Estimation"; verify fee estimation is called again and succeeds.
      - Modal opens; complete the stream creation.
      
      **Rationale:** Manual verification ensures the UX is intuitive and the recovery paths work end-to-end.
      
      **Files to verify:**
      - `frontend/src/components/CreateStreamForm.tsx`
      - Network requests (dev tools) for duplicate transaction detection.
      
      **Verify:** Complete all scenarios without errors; check browser console for no unexpected warnings or errors; verify network tab shows no duplicate POST requests to `/api/streams`.

---

## Summary of Changes

| Phase | Component | What | Why |
|-------|-----------|------|-----|
| 1 | CreateStreamForm.tsx | Add `isConfirming` state | Prevent duplicate submissions during confirmation |
| 2 | CreateStreamForm.tsx | Add "Retry Estimation" button | Explicit recovery path for transient fee estimation failures |
| 3 | CreateStreamForm.tsx | Add "Retry Confirmation" and "Edit" buttons in modal | Explicit recovery paths for submission failures and balance issues |
| 4 | CreateStreamForm.test.tsx | Add 3 new test cases | Ensure retry behavior works correctly |
| 5 | CreateStreamForm.tsx | Add JSDoc comments | Document recovery UX design |
| 6 | Manual test | Verify end-to-end workflows | Ensure UX is intuitive and no duplicate transactions occur |

## Acceptance Criteria (Mapped to Plan Items)

✅ **A simulated failure shows a useful message** (Item 1–3)
- Existing `humaniseApiError()` converts backend errors to user-friendly titles and hints.
- Retry buttons are visible and labeled clearly.

✅ **Retry works** (Items 2–3, 4, 6)
- Fee estimation can be retried via "Retry Estimation" button.
- Stream creation can be retried via "Retry Confirmation" button in modal.
- Test cases verify retry paths work; manual test verifies end-to-end.

✅ **No duplicate action is sent** (Item 1, 4, 6)
- `isConfirming` flag prevents double-clicks on "Confirm" button.
- Test case verifies `onCreate` is called exactly twice on retry (not three times).
- Manual test verifies network tab shows no duplicate POST requests.

✅ **Add or update relevant tests** (Item 4)
- Three new unit test cases in CreateStreamForm.test.tsx.
- All existing tests continue to pass.

✅ **Add or update documentation** (Item 5)
- JSDoc comments explain the recovery flow and how form state is preserved.
- Inline comments document stale balance detection (reactive, not proactive).

---

## Out of Scope (Future Work)

- **Proactive balance check before submission:** Would require a new `getWalletBalance()` API endpoint and a hook like `useWalletBalance()`. Deferred to a future iteration.
- **Balance reconciliation after failed submission:** Refreshing the wallet balance from the blockchain to confirm it has changed. Out of scope for this issue.
- **Automatic retry after a delay:** Exponential backoff or retry-after headers. Out of scope; manual retry is sufficient for MVP.
