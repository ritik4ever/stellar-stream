# Add Stream Activity History

- Complexity: Medium
- Points: 150
- Labels: `stellar-wave`, `backend`, `analytics`

## Problem
There is no event history for stream create/cancel/claim actions.

## Scope
- Emit events for stream lifecycle actions.
- Build a small indexer worker to store event history.
- Add API endpoint for stream history timeline.

## Acceptance Criteria
- History endpoint returns ordered lifecycle events.
- Events persist across backend restarts.
- Frontend can display stream timeline data.
