# Stats Panel Edge and Failure States Runbook (SSB-2026-090)

## Overview
This runbook documents the boundary behavior, edge conditions, and failure resilience for the Stats Panel component (`frontend/src/components/StatsPanel.tsx`).

## Edge States and Fault Handling
1. **All-Zero Totals**:
   - When no streams exist or all amounts are zero (`total = 0, active = 0, completed = 0, vested = 0`), the panel renders clean zero values (`0` and `0.00`) without displaying `NaN`, undefined, or blank placeholders.
2. **Partially Available Totals**:
   - If only a subset of metrics is populated (e.g. active streams loaded, but completed streams count is 0), available counts are rendered accurately with fallback values for missing entries.
   - Non-finite or negative numbers are clamped to zero.
3. **Stats Failing While Streams Still Load**:
   - If the stats API call fails due to a network disruption or gateway timeout, an accessible error banner (`role="alert"`) displays with a descriptive error message and an actionable **Retry** button.
   - Background streams loading is not interrupted, preserving user context and page functionality.

## Verification
- Unit test suite: `frontend/src/components/StatsPanel.test.tsx` using deterministic mocks without live testnet calls.
