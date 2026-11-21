# Metrics Chart Recovery and Stale Data Handling (SSB-2026-082)

## Overview
This runbook documents fault recovery, edge state handling, and stale data synchronization for the `StreamMetricsChart` component (`frontend/src/components/StreamMetricsChart.tsx`).

## Edge States and Fault Resilience
1. **Empty Data and Single Data Point**:
   - `data.length === 0`: Renders an accessible empty state (`No Chart Data Yet`) prompting the user that metrics will populate over time.
   - `data.length === 1`: Computes a single-day visible range header (`Showing <date>`) without numerical instability, division by zero, or NaN in zoom boundaries.
2. **Stale Data Reconnect Path**:
   - When cached or delayed metrics data is returned (`isStale = true`), a status banner (`role="status"`) alerts the user with an actionable **Sync Latest** reconnect button.
   - Prevents duplicate requests and preserves the user's active viewport/pan position while refreshing.
3. **Actionable Failure Recovery**:
   - When metric fetch fails, an accessible error card displays the error message and provides a dedicated **Retry** action button that re-triggers telemetry fetch without full page reload.

## Verification
- Unit test suite: `frontend/src/components/StreamMetricsChart.recovery.test.tsx`.
