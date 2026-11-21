# Metrics Chart Accessibility and Keyboard Operability (SSB-2026-083)

## Overview
This document specifies accessibility standards and keyboard/screen reader integration for the `Metrics chart` component (`StreamMetricsChart.tsx`), ensuring full compliance with WCAG principles.

---

## 1. Problem Statement
Previously, interactive chart controls (box zoom toggle, zoom in, zoom out, reset) operated without accessible status announcements for screen readers when visible date ranges shifted. In addition, chart containers lacked explicit landmark roles and accessible unit/axis descriptions for non-sighted users.

---

## 2. Implemented Accessibility Features

1. **Landmark Scoping and Axis Descriptions:**
   - The main chart wrapper exposes `role="region"` and `aria-label="Stream metrics charts and trends"`.
   - The time-range header element includes `tabIndex={0}` and an accessible label detailing the time range and unit representations (`Y-axis displays vested amounts in asset units and stream counts`).

2. **Polite Screen Reader Announcements (`role="status"`):**
   - An offscreen live region (`role="status"`, `aria-live="polite"`, `aria-atomic="true"`, `data-testid="metrics-a11y-announcement"`) announces:
     - Visible time range changes on load and zoom.
     - Zoom in: `Zoomed in to narrower time range.`
     - Zoom out: `Zoomed out to wider time range.`
     - Reset: `Zoom reset to full time range.`
     - Interaction mode: `Switched to Zoom mode.` / `Switched to Pan mode.`
   - Avoids repetitive alert spam (`role="alert"` is reserved solely for critical error states).

3. **Keyboard Operability:**
   - Controls are fully reachable via sequential keyboard Tab navigation.
   - Zoom and mode toggle buttons support Space and Enter key activation.
   - Disabled states (`disabled`, `aria-disabled="true"`) are programmatically communicated on boundary conditions (e.g. single data points or unzoomed states).

---

## 3. Verification
- **Test File:** `frontend/src/components/StreamMetricsChartA11y.test.tsx`
- **Coverage:**
  - Asserts region landmark and accessible time range descriptions.
  - Verifies polite live announcements on zoom in, reset, and mode toggle.
  - Asserts focus order and absence of alert spam on routine interactions.
