# Stream Progress Display Edge and Failure States (SSB-2026-055)

## Overview
This document specifies the boundary conditions, edge states, and lifecycle update behavior tested for the Stream progress display in `StreamDetailDrawer`.

## Edge Cases Covered
1. **Start Timestamp Boundary (0% Vested):**
   - When `now <= startAt` or `percentComplete === 0`, progress bar safely displays 0% without division-by-zero or NaN errors.
   - Initial total amount matches remaining amount (`vestedAmount = 0`, `remainingAmount = totalAmount`).
   - Action controls (such as pause or cancel) remain accessible and operable.

2. **End Timestamp Boundary (100% Vested / Finalised):**
   - When stream duration elapses (`percentComplete === 100` and `status === "completed"`), progress is capped at 100% and remaining amount is 0.
   - Stream is treated as finalised; modification actions (pause, cancel) are disabled or omitted to prevent conflicting contract calls.

3. **Background Tab Visibility Handling:**
   - When the user switches tabs (`document.visibilityState === "hidden"`), polling and heavy updates are paused.
   - When the user returns to the tab (`document.visibilityState === "visible"`), an automatic refresh call (`fetchData(streamId, true)`) synchronizes the on-chain vesting state immediately.

4. **Out-of-Bounds Clamping:**
   - Percentages are strictly clamped using `Math.min(100, Math.max(0, percentComplete))`.
   - Remaining amounts are clamped using `Math.max(0, remainingAmount)` to guard against floating-point underflow or contract rounding discrepancies.

## Verification
- Unit test suite: `frontend/src/components/StreamProgressDisplayEdgeStates.test.tsx`
