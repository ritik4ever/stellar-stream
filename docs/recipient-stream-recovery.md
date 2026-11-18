# Recipient Stream View Recovery Runbook (SSB-2026-027)

## Overview
This runbook documents the recovery path, error state management, and mid-request wallet switching resilience for the Recipient Dashboard view.

## Fault Isolation & Recovery Architecture
1. **Actionable Failure State**:
   - When fetching recipient streams encounters a transient gateway timeout or network error, an accessible alert card renders with the error message and an actionable **Retry** trigger.
   - Clicking Retry resets the error boundary and re-queries the Horizon gateway without requiring a full page refresh.
2. **Safe Mid-Request Wallet Switching**:
   - If the connected wallet address switches while a fetch or claim operation is actively in flight, the preceding in-flight promise is invalidated via the effect cleanup handler.
   - New streams are immediately queried for the newly active address, preventing race conditions or contaminated state across multiple accounts.
3. **Idempotent Actions**:
   - Reconnection and retry mechanisms prevent duplicate mutations or unintended double-claims.

## Verification
- Unit test suite: `frontend/src/components/RecipientDashboard.recovery.test.tsx`.
