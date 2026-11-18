# Create Stream Schedule Edge & Failure States Runbook (SSB-2026-010)

## Overview
This runbook covers edge-case validations and simulated failure handling for stream schedule configurations in `CreateStreamForm`.

## Specifications

### 1. Current-Minute Boundary State
- Streams configured with `startInMinutes = 0` represent immediate vesting starting on transaction inclusion in the current block minute.
- Surfaces an explicit `Current-minute boundary` tag (`data-testid="boundary-current-minute"`) and formatted UTC end timestamp.

### 2. Device Clock & Timezone Mismatch Failure States
- When network or RPC nodes reject submission due to timestamp drift or clock skew:
  - Form displays humanised `Device clock or timezone mismatch` alert.
  - The submit control is rendered in a disabled `Clock Out of Sync` state with helpful title guidance, avoiding spurious failed retry loops until system clock synchronization occurs.

### 3. Duration & Offset Boundary Validations
- Durations $< 1$ minute are blocked (`Duration must be at least 1 minute`).
- Negative offsets are blocked (`Must be 0 or a positive whole number`).

## Verification
- Test suite: `frontend/src/components/CreateStreamScheduleEdge.test.tsx`
