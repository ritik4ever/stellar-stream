# Create Stream Amount Edge & Failure States Runbook (SSB-2026-005)

## Overview
This document covers edge-case handling, precision rules, and failure recovery states for the stream creation amount input in `CreateStreamForm`.

## Specifications

### 1. Fractional Asset Precision (Stellar 7-Decimal Standard)
- Stellar amounts map to stroops ($10^{-7}$ units).
- Valid inputs: Any fractional amount up to 7 decimal places (e.g. `10.1234567`).
- Precision overflow: Fractional inputs with $>7$ decimal places (e.g. `10.12345678`) are immediately blocked with the inline error:
  `Amount supports at most 7 decimal places (Stellar precision).`
- Zero and negative values are strictly prohibited (`Amount must be greater than zero.`), disabling form submission.

### 2. Stale Balance & Rejected Submit Recovery
- **Reactive Stale Balance Detection**: If the API or RPC reports insufficient or stale balance upon submission or fee check, the error is humanised into `Insufficient or stale balance` with clear guidance to refresh wallet balances.
- **Confirmation Modal Failure State**: When stream creation fails on submit:
  - The confirmation dialog remains open in an accessible alert state (`role="alert"`).
  - Users are given two safe recovery actions:
    1. `Retry Confirmation`: Immediately re-attempts the creation payload without losing context.
    2. `Edit`: Safely dismisses the confirmation overlay, returning the user to the form where all entered values (including the amount) remain intact via form state and draft autosave.

## Verification
- Test suite: `frontend/src/components/CreateStreamAmountEdge.test.tsx`
