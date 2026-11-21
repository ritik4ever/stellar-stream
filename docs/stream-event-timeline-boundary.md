# Stream Event Timeline Boundary State (SSB-2026-056)

## Overview
This document specifies how `StreamTimeline` handles simultaneous events sharing the exact same timestamp and independent history loading states.

## Clarified Behaviors
1. **Deterministic Sorting for Identical Timestamps:**
   - When two or more events occur in the same ledger block or share identical timestamps (`a.timestamp === b.timestamp`), `computeFilteredEvents` falls back to sorting by `event.id` (`a.id - b.id`), ensuring stable UI rendering without flicker.
2. **Explicit Simultaneous Event Indicator:**
   - Events sharing a timestamp with another event are identified via `isConcurrentEvent()`.
   - An explicit badge (`Simultaneous event`) is displayed adjacent to the event title, clarifying that both events were finalized concurrently on ledger.
3. **Independent History Loading State:**
   - `StreamTimeline` renders an accessible loading state (`role="status"`, `aria-label="Loading event history"`, `data-testid="timeline-loading-state"`) while asynchronous history requests are pending, preventing misleading ready-to-act UI states.

## Verification
- Unit test suite: `frontend/src/components/StreamTimelineBoundary.test.tsx`
