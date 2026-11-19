# Stream Event Timeline Accessibility and Screen Reader Support (SSB-2026-058)

## Overview
This document specifies the keyboard navigation, screen reader accessibility (a11y), and semantic ARIA landmarks implemented for the `StreamTimeline` component.

## Accessibility Features
1. **Semantic Feed & Article Structure:**
   - The timeline container declares `role="feed"` with `aria-label="Stream event timeline"`.
   - Each event entry is represented as an `<article>` with `role="article"`, `tabIndex={0}`, `aria-posinset`, `aria-setsize`, and `aria-labelledby` referencing the event title.
2. **Polite Status Announcements:**
   - A dedicated live region (`role="status"`, `aria-live="polite"`, `className="sr-only"`) announces the total number of events rendered and any active filter criteria without firing repeated disruptive alerts.
3. **Keyboard Focus Order:**
   - Users can navigate sequentially across filter buttons and timeline event articles using standard `Tab` and `Shift+Tab`.
4. **Decorative Emoji Hiding:**
   - Event icons (`🚀`, `💸`, `❌`, etc.) are hidden from screen readers via `aria-hidden="true"`, preventing redundant emoji announcements.
5. **Accessible Concurrent Badges:**
   - Simultaneous event indicators include descriptive `aria-label="Simultaneous event occurred at the same ledger timestamp"`.

## Verification
- Unit test suite: `frontend/src/components/StreamTimelineA11y.test.tsx`
