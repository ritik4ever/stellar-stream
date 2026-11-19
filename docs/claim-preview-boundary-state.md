# Claim Preview Boundary States (SSB-2026-061)

## Overview
This document specifies the boundary state handling implemented in the Claim preview component (`ClaimBatchModal`) for zero claimable balances and partial claim scenarios.

## Problem Addressed
Previously, when the batch claim preview completed fetching claimable balances, if none of the streams had vested funds or only a subset of streams were claimable, the component rendered a generic summary and an active `Confirm claim` button. This created a misleading ready-to-act UI when nothing was actually claimable.

## Key Changes
1. **Explicit Zero Claimable Boundary Notice:**
   - When `state.totalClaimable <= 0`, an explicit status notice (`data-testid="claim-preview-zero-notice"`) informs the user that zero balance has vested yet.
   - The primary action button is disabled with accessible styling and label `"Nothing to claim"` (`data-testid="claim-confirm-btn"`, `aria-disabled="true"`).

2. **Explicit Partial Claim Notice:**
   - When `state.totalClaimable > 0` but only a subset of streams have vested funds (`claimableStreamsCount < streamCount`), an informational notice (`data-testid="claim-preview-partial-notice"`) states clearly how many streams are ready to claim.
   - The primary button updates its label dynamically to `"Confirm partial claim"`.

3. **Full Claim Confirmation:**
   - When all streams have claimable balances, the standard `"Confirm claim"` action is presented.

## Verification
- Unit test suite: `frontend/src/components/ClaimPreviewBoundary.test.tsx`
- Covers zero claimable boundary, partial claim notice, and standard full claim flows.
