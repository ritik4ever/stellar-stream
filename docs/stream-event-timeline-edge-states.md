# Stream Event Timeline Edge and Failure States (SSB-2026-060)

## Overview
This document specifies the edge cases and failure resilience mechanisms covered for the `StreamTimeline` component in `frontend/src/components/StreamTimeline.tsx`.

## Key Scenarios Covered
1. **Identical Timestamp Collision (Simultaneous Events):**
   - When multiple blockchain events share the exact same ledger timestamp, `computeFilteredEvents` enforces deterministic tie-breaking using the unique event `id` (`a.timestamp - b.timestamp || a.id - b.id`).
   - `isConcurrentEvent` detects concurrent ledger events and surfaces an explicit, accessible badge (`Simultaneous event`) with distinct visual styling.

2. **History Loading Independently of Stream Detail:**
   - In both stream-scoped and global feed modes, event history resolves asynchronously and independently from parent stream details.
   - While history is in-flight, `StreamTimeline` renders accessible skeleton loaders (`role="status"`, aria-label="Loading event history") without blocking surrounding UI.

3. **Failure Recovery and Error Boundaries:**
   - If history fetching encounters network timeouts or 5xx server errors, an accessible alert boundary is rendered (`role="alert"`, `Unable to load activity`).
   - The user is provided an actionable retry control (`data-testid="timeline-retry-btn"`) that resets error states and re-executes `loadHistory`.
   - If active filters were enabled, a secondary `Reset filters` control resets active filters and facilitates graceful state recovery.

## Verification
- Unit test suite: `frontend/src/components/StreamTimelineEdgeStates.test.tsx`
- Fully deterministic tests with isolated mocks and zero live testnet dependencies.
