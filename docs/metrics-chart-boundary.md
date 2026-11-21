# Metrics Chart Boundary State Handling (SSB-2026-081)

## Overview
This document specifies boundary state handling for the `Metrics chart` workflow (`StreamMetricsChart.tsx`), clarifying user experience across:
1. `Empty data`
2. `Single data point`
3. `Stale data`

---

## 1. Problem Statement
Previously, when the metrics chart received only a single snapshot or empty array, interactive controls (such as box zoom, pan mode, and zoom in/out) could either appear ready-to-act or fail to clarify that zooming a single point is invalid. Stale cached data also required explicit visual demarcation from fresh live streams.

---

## 2. Implemented Boundary States

1. **Empty Data (`data.length === 0`):**
   - Displays dedicated empty state container (`data-testid="metrics-empty-state"`).
   - Features `Empty Data` badge (`data-testid="boundary-empty-badge"`).
   - Suppresses misleading zoom/pan control headers.
   - Provides an actionable `Check For Metrics` button (`data-testid="metrics-empty-retry-btn"`) when `onRetry` callback is provided.

2. **Single Data Point (`data.length === 1`):**
   - Renders an explicit informational banner (`data-testid="metrics-single-point-notice"`).
   - Displays `Single Point` badge (`data-testid="boundary-single-point-badge"`).
   - Informs users that trend lines and range calculations require at least two snapshots over time.
   - Safely disables range-dependent controls (`Zoom In`, `Zoom Out`, `Pan Mode`) with informative tooltips (`title="Zoom requires multiple data points"`).

3. **Stale Data (`isStale === true`):**
   - Renders a prominent status banner (`data-testid="metrics-stale-banner"`).
   - Displays `Stale Data` badge (`data-testid="boundary-stale-badge"`).
   - Primary action button `Sync Latest` (`data-testid="metrics-reconnect-button"`) triggers re-sync with backend RPCs.

---

## 3. Verification
- **Test File:** `frontend/src/components/StreamMetricsChartBoundary.test.tsx`
- **Coverage:**
  - Asserts empty data badge, message, and retry button while verifying suppression of chart controls.
  - Asserts single data point badge, snapshot details, and disabled zoom controls.
  - Asserts stale data badge and `Sync Latest` primary action.
