# Sender Dashboard — Mobile & Narrow Screens (320px / 768px)

**Issue**: [#966 [MOBILE] Keep Sender dashboard usable on narrow screens](https://github.com/ritik4ever/stellar-stream/issues/966)  
**Batch ID**: SSB-2026-024  
**Area**: `frontend`  
**Branch**: `feat/ssb-2026-024-sender-dashboard-mobile`

---

## Overview

This document details the mobile responsiveness and narrow-viewport optimizations implemented for the Sender Dashboard under issue #966.

The implementation ensures the Sender dashboard remains fully functional, readable, and touch-operable across narrow viewports down to **320px** (small mobile) and **768px** (tablet/large mobile), without horizontal clipping of critical amounts or stream action controls.

---

## Reviewed Workflows & Edge Cases

### 1. Zero Streams
- When a sender wallet has no streams, the dashboard presents a centered empty state card (`.activity-empty`).
- Verified at 320px: icon, description, and the `"Create your first stream"` call-to-action button render without horizontal overflow.
- CTA button provides a touch target of >= 44px min-height with full horizontal padding.

### 2. Very Large Stream Lists (150+ Streams)
- Metric cards (`Total Streams Created`, `Total Amount Streamed`, `Active Streams`, `Completed/Canceled`, asset breakdowns) automatically wrap into a 2-column grid at <=768px and single column at <=480px, avoiding layout overflow.
- Active & Scheduled and History tables are wrapped in `.table-wrap` with bounded vertical height (`max-height: 480px`), vertical auto-scroll, horizontal auto-scroll (`overflow-x: auto`), and `-webkit-overflow-scrolling: touch`.
- Table minimum width is pinned to `580px`, preventing columns from collapsing into unreadable slivers while allowing smooth horizontal swiping on mobile devices.
- Aggregate analytics and status bar charts calculate correctly for 150+ items without performance or layout degradation.

### 3. Stream Request Returning a Recoverable Error
- When dashboard loading, single-stream cancellation, or bulk cancellation encounters a recoverable error:
  - Error banners (`.api-error-box` and `.activity-error`) wrap buttons with `flex-wrap: wrap` to prevent clipping on 320px screens.
  - Actionable **Retry** and **Reconnect Wallet** buttons have dedicated touch target minimums (>= 38px to 44px).
  - Selected streams and safe inputs are preserved so retrying does not lose user context or issue duplicate requests.

---

## Responsive Design Specifications

### Breakpoints
- **Tablet / Medium Screens (`@media (max-width: 768px)`)**:
  - Dashboard header flexes into column layout with full-width action controls.
  - Metrics grid switches to `repeat(2, 1fr)`.
  - Filter bar fields wrap responsively with 100% width distribution.
  - Quick action bar and bulk cancellation controls stack with full-width buttons.

- **Narrow Mobile Screens (`@media (max-width: 480px)` down to 320px)**:
  - Metrics grid collapses to 1 column.
  - Form inputs and select dropdowns enforce `font-size: 16px` to prevent iOS Safari auto-zooming on focus.
  - Buttons expand to full-width or flex-grow with explicit `min-height: 44px`.
  - Modal action dialogs stack actions vertically with full-width touch targets.

### Critical Amount & Account ID Protection
- **Amounts (`.cell-amount`)**:
  - `white-space: nowrap; font-variant-numeric: tabular-nums; font-weight: 600;`
  - Guarantees the amount and currency asset code (e.g. `1000 USDC`) are never split across lines or clipped horizontally.
- **Account IDs & Addresses (`.truncate-address`)**:
  - Mid-string truncation keeps the identifier readable on narrow tables (`GRECIPIE…xxxx`).
  - Full address is accessible via `title` attribute and screen-reader `aria-label="Recipient: <full_address>"`.
- **Horizontal Overflow Containment (`.table-wrap`)**:
  - Tables specify `min-width: 580px` enclosed within `overflow-x: auto; max-width: 100%`.
  - Ensures narrow screens can scroll the table horizontally without blowing out the page layout or obscuring table action cells.

### Touch Target Sizing (WCAG 2.5.5 / 2.5.8)
- Action buttons (`.btn-cancel`, `.btn-ghost`, `.btn-edit`) enforce `min-height: 38px` (desktop/tablet) and `min-height: 44px` (mobile), with `min-width: 44px`.
- Checkboxes in table headers and rows are styled with `width: 20px; height: 20px; min-width: 20px; min-height: 20px;` with expanded tap area padding.
- Filter select dropdowns, search inputs, and modal confirm/cancel buttons meet the 44px minimum touch target height.

---

## Filter & Sort Selection

A dedicated responsive toolbar (`.sender-filter-bar`) has been added above the stream tables:
- **Status Filter**: Dropdown allowing users to filter by `All Statuses`, `Active`, `Scheduled`, `Paused`, `Completed`, or `Canceled`.
- **Sort Dropdown**: Options for `Default Order`, `Amount: High to Low`, `Amount: Low to High`, `Newest First`, and `Oldest First`.
- **Search Input**: Live filtering matching recipient address or stream ID.
- **Reset Button**: Appears when non-default filter/search criteria are active to quickly restore default stream view.
- **Empty State**: When filters yield 0 matching streams, displays `"No streams match your filter criteria"` along with a `"Clear Filters"` button.

---

## Automated Test Coverage

All mobile enhancements are covered by 33 unit and integration tests in `frontend/src/components/SenderDashboard.test.tsx`:
1. `renders responsive mobile toolbar with status filter, sort, and search controls`
2. `filters streams by status using the mobile status filter`
3. `sorts streams by amount descending when amount-desc is selected`
4. `filters streams by search text and shows clear-filters button when zero streams match`
5. `ensures critical amount column and action buttons have touch targets without horizontal clipping`
6. `renders zero-streams mobile empty state without clipping and with usable CTA target`
7. Comprehensive verification of large stream lists (150+ streams) with sticky headers and scroll containment.
8. Preservation of all keyboard navigation and screen-reader polite live announcements from SSB-2026-023.
