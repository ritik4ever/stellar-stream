# Create Stream Schedule Boundary States Runbook (SSB-2026-006)

## Overview
This runbook covers explicit UX boundary state handling for stream start scheduling in `CreateStreamForm`.

## Boundary Specifications

### 1. Current-Minute Boundary (`startInMinutes = 0`)
- **State Indicator**: Renders an explicit boundary tag `Current-minute boundary` (`data-testid="boundary-current-minute"`) within the schedule preview.
- **Description**: Displays `Starts immediately (current minute)` along with the calculated UTC end time, clarifying that vest begins on transaction execution rather than a future block.

### 2. Device Clock & Timezone Mismatch
- **State Indicator**: Detects client-network clock skew errors and displays `Device clock or timezone mismatch` with clear remediation instructions to enable OS automatic network time sync.
- **Prevent Misleading Actions**: The submit action control is replaced by a disabled button (`Clock Out of Sync`) with explicit title guidance, preventing repeated failed RPC submission cycles.

## Verification
- Test suite: `frontend/src/components/CreateStreamScheduleBoundary.test.tsx`
