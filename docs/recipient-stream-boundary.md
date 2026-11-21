# Recipient Stream View Boundary State Runbook (SSB-2026-026)

## Overview
This runbook documents the boundary behavior for the Recipient Dashboard view when a recipient has active streams but zero claimable funds, and mid-request wallet switching safeguards.

## Boundary Behaviors
1. **Zero Claimable Balance with Active Streams**:
   - When streams are active but unvested (`vestedAmount = 0`), an explicit notice (`No claimable balance yet. Streams are active, but funds have not vested yet.`) is rendered.
   - Individual claim buttons clearly display `Nothing to claim` and are disabled, preventing misleading click targets.
   - The batch `Claim all` button is disabled when total claimable balance is zero.
2. **Active Claimable State**:
   - As vesting progresses and `vestedAmount > 0`, claim buttons transition dynamically to enabled state with exact claimable asset amounts (`Claim <amount> <asset>`).
3. **Wallet Account Switching Resilience**:
   - Guarantees that if the connected wallet changes mid-request, in-flight callbacks do not mutate or contaminate state for the new recipient.

## Verification
- Unit test suite: `frontend/src/components/RecipientDashboard.boundary.test.tsx`.
