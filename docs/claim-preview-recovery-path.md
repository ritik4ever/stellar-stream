# Claim Preview Recovery Path (SSB-2026-062)

## Overview
This document specifies the error recovery and retry flow implemented in `ClaimBatchModal` for transaction failures and signature rejections by the connected Web3 wallet.

## Problem Addressed
When a recipient initiated a claim from the preview modal, if the user rejected the wallet signature request or an on-chain network timeout occurred, the modal left the user without an actionable retry path, forcing them to close the modal and restart the entire selection process.

## Key Changes
1. **Actionable Recovery Alert:**
   - Detects failures such as `Wallet rejected signature` or `User declined transaction` and renders an explicit recovery alert (`data-testid="claim-error-recovery"`).
   - Surfaces clear error messaging (`data-testid="claim-error-message"`) explaining that input state is safely preserved.

2. **Idempotent Retry Flow:**
   - Provides a direct `Retry claim` action (`data-testid="claim-retry-btn"`) that re-triggers the signature/settlement flow without duplicate submissions or input loss.
   - Guards against double-submits by disabling controls while `isClaiming` is active (`if (isClaiming) return;`).

3. **Safe Dismissal:**
   - An accessible `Cancel` / `Dismiss` action (`data-testid="claim-cancel-btn"`) allows safe exit if the user chooses not to retry.

## Verification
- Unit test suite: `frontend/src/components/ClaimPreviewRecovery.test.tsx`
- Simulates wallet signature rejection, verifies recovery message and retry dispatch.
