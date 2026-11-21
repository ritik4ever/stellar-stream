# Bulk Selection Partial Failure Recovery Path (SSB-2026-072)

## Overview
This document specifies the fault recovery architecture for the Bulk Selection workflow (`SenderDashboard.tsx` and `StreamsTable.tsx`) when one or more stream actions in a batch fail or encounter RPC timeouts.

---

## 1. Problem Addressed
When executing batch actions (such as bulk cancellation across multiple selected streams), transient network failures or ledger conflicts may cause a subset of stream operations to fail while others succeed. Re-submitting the entire original batch would dispatch duplicate calls to already canceled streams, triggering errors or unnecessary gas expenditure.

---

## 2. Recovery Architecture

1. **Selective Failure Isolation & Input Preservation:**
   - Tracks individual operation outcomes in `confirmBulkCancel()`.
   - Streams that succeed are cleared from the selection set.
   - Succeeded streams reflect their updated status immediately via optimistic state sync and list re-fetch.
   - Only the failed stream IDs (`failedIds`) are retained in `selectedStreamForBulkCancel`.

2. **Actionable Feedback & Informative Messaging:**
   - Emits a structured alert indicating exact progress: `X of Y stream(s) could not be canceled: <error details>`.
   - The primary toolbar button dynamically updates its target count to `Bulk cancel X selected stream(s)`.
   - Displays a dedicated `Retry Bulk Cancel` action (`data-testid="bulk-cancel-retry-btn"`).

3. **Zero Duplicate Dispatch Guarantee:**
   - Triggering retry targets strictly the remaining subset of failed streams.
   - Protects with an in-flight concurrency lock (`isBulkCanceling`), disabling the button and ignoring repeated clicks while a retry request is active.
   - Upon successful retry, the selection set is emptied and the error banner is dismissed.

---

## 3. Verification
- **Test File:** `frontend/src/components/BulkSelectionRecovery.test.tsx`
- **Coverage:**
  - Simulates partial failure on stream 2 of 2.
  - Asserts retention of failed stream in selection set and removal of succeeded stream.
  - Verifies retry executes strictly on the failed stream with zero duplicate calls to the succeeded stream.
