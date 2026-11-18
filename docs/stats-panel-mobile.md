# Stats Panel Mobile and Narrow Screen Runbook (SSB-2026-089)

## Overview
This runbook documents the mobile and responsive design adaptations for the Stats Panel (`frontend/src/components/StatsPanel.tsx`) at 320px and 768px widths.

## Responsive Design Specifications
1. **Narrow Viewport (320px - 360px)**:
   - Metric cards adapt to a responsive 2-column grid (`grid-template-columns: repeat(2, minmax(0, 1fr))`) to prevent horizontal page scrolling.
   - Text values apply `overflow-wrap: anywhere; word-break: break-word;` ensuring large numerical amounts and decimals never overflow card boundaries.
   - Long 56-character Stellar account IDs are contained with `text-overflow: ellipsis; white-space: nowrap;` and explicit `title` attributes for full hover transparency.
2. **Tablet Viewport (768px)**:
   - Metric cards smoothly expand to `repeat(auto-fit, minmax(120px, 1fr))` ensuring all 4 summary metrics (Total, Active, Completed, Vested) are visible simultaneously without visual clutter.
3. **Touch Target Accessibility**:
   - The interactive Retry button satisfies WCAG 2.5.5 / 2.5.8 touch target standards with minimum 44px height and responsive full-width expansion on narrow screens.

## Verification
- Unit and UI test suite: `frontend/src/components/StatsPanel.mobile.test.tsx`.
