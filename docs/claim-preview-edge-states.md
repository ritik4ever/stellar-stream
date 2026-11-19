# Claim Preview Edge and Failure States (SSB-2026-065)

## Overview
This document specifies the end-to-end behavioral requirements and unit test coverage for the `Claim preview` modal (`ClaimBatchModal`) under critical boundary and error conditions:
1. Zero claimable balance across selected streams.
2. Partial claim availability where only a subset of streams have vested funds.
3. Wallet signature rejection / user decline during the claim signing lifecycle.

All edge cases are covered by isolated UI tests using stable synthetic mocks without requiring live testnet or Horizon RPC connectivity.

---

## 1. Zero Claimable Amount Boundary
- **Precondition:** Recipient selects one or more streams, but total vested amount across all selected streams is $\le 0$.
- **Observed Behavior:**
  - An explicit status banner (`data-testid="claim-preview-zero-notice"`) informs the recipient: *"No claimable balance. All selected streams currently have zero claimable balance. Funds will become available as streams vest."*
  - The confirmation button displays `Nothing to claim`, has `aria-disabled="true"`, is disabled, and ignores mouse clicks or keyboard submission attempts.
  - The `Cancel` button remains active, allowing users to safely dismiss the modal without initiating contract calls.

---

## 2. Partial Claim Boundary
- **Precondition:** Multiple streams are selected ($> 1$), but only a subset have non-zero claimable balances ($0 < \text{claimableStreams} < \text{totalStreams}$).
- **Observed Behavior:**
  - A contextual status notice (`data-testid="claim-preview-partial-notice"`) indicates the exact eligible stream count and claimable sum: *"Partial claim available. Only X of Y streams have vested funds ready to claim (Amount Asset)."*
  - The confirmation button dynamically adapts its label to `Confirm partial claim`.
  - Triggering confirmation submits only the eligible streams, preventing unnecessary transaction failures on zero-balance streams.

---

## 3. Wallet Signature Rejection Failure State
- **Precondition:** The user or hardware wallet rejects/declines the cryptographic transaction signature prompt, or the wallet session aborts.
- **Observed Behavior:**
  - The modal transitions to a prominent alert card (`data-testid="claim-error-recovery"`) with `role="alert"`.
  - The title clearly states `Wallet Signature Rejected` (or `Transaction Failed` for network errors).
  - The specific error message (`data-testid="claim-error-message"`) is displayed cleanly without truncation.
  - Clarifying guidance informs the user: *"Your claim input is preserved. Verify your wallet connection and click below to retry safely."*
  - Dedicated action controls allow the user to either `Retry claim` (re-prompting the wallet signature with identical parameters) or `Cancel` (dismissing the modal safely).

---

## 4. Verification
- **Test File:** `frontend/src/components/ClaimPreviewEdgeStates.test.tsx`
- **Coverage Criteria:**
  - Asserts visible UI state, role attributes, and notice text for zero and partial claims.
  - Asserts disabled state and inert click handlers on zero claimable button.
  - Asserts signature rejection recovery box, retry invocation, and clean modal dismissal.
  - Verifies zero reliance on live network or testnet dependencies.
