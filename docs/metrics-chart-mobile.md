# Metrics Chart Mobile Usability Runbook (SSB-2026-084)

## Overview
This runbook documents the mobile usability enhancements and narrow screen adaptations for the `StreamMetricsChart` component at 320px and 768px widths.

## Responsive Design Specifications
1. **Narrow Viewport (320px)**:
   - Header controls wrap cleanly (`flex-wrap: wrap`) preventing toolbar elements from clipping off-screen.
   - Interactive zoom buttons (Zoom In, Zoom Out, Reset, Mode Toggle) meet WCAG 2.5.5 / 2.5.8 touch target standards with minimum 44px height and width.
   - Date range text incorporates `overflow-wrap: anywhere` to prevent string overflows.
2. **Tablet Viewport (768px)**:
   - Full chart canvas seamlessly scales with ResponsiveContainer across area and bar charts without vertical or horizontal distortion.
3. **Accessibility**:
   - Each control button includes explicit, descriptive `aria-label` attributes for screen readers.

## Verification
- Unit test suite: `frontend/src/components/StreamMetricsChart.mobile.test.tsx`.
