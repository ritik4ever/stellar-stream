# Stream Event Timeline Recovery Path (SSB-2026-057)

## Overview
This document outlines the recovery and retry mechanics implemented in `StreamTimeline` when asynchronous event history fetching encounters network timeouts, rate limits, or RPC failures.

## Resilience Enhancements
1. **Actionable Error Feedback:**
   - Simulated or real network errors surface an explicit alert banner (`role="alert"`, `data-testid="timeline-error-state"`).
   - The specific error message is displayed to the user (`data-testid="timeline-error-message"`).
2. **One-Click Recovery (`Try again`):**
   - An actionable `Try again` button triggers `loadHistory()` without requiring a full page or drawer reload.
3. **Duplicate Request Prevention:**
   - `inFlightRef` locks simultaneous fetch invocations during retry operations, preventing duplicate network calls or race conditions if the user rapidly double-clicks the retry control.
4. **Input & Filter Preservation:**
   - Active filter sets and search state remain preserved during and after transient error recovery.

## Verification
- Unit test suite: `frontend/src/components/StreamTimelineRecovery.test.tsx`
