# Create Stream Schedule Keyboard & Screen Reader Accessibility Runbook (SSB-2026-008)

## Overview
This runbook documents accessibility (A11Y) implementations for stream schedule inputs and live timestamp previews in `CreateStreamForm`.

## Specifications

### 1. Keyboard Navigation & Tab Order
- Sequential keyboard focus progression: Duration (minutes) $\to$ Start In (minutes) $\to$ Cliff Period (days) $\to$ Submit Button.
- All schedule input fields are fully navigable via standard keyboard controls without focus traps.

### 2. Live Announcements & ARIA Semantics
- The schedule preview banner applies `role="status"` and `aria-live="polite"`, communicating UTC start and end timestamps non-disruptively.
- Input validation warnings map dynamically via `aria-describedby` and `role="alert"`.
- Review dialog duration rows apply explicit semantic linking using `aria-labelledby="review-duration-dt"`.

## Verification
- Test suite: `frontend/src/components/CreateStreamScheduleA11y.test.tsx`
