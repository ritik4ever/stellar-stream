# Sender Dashboard Mobile Responsiveness

**Batch ID**: `SSB-2026-024` | **Issue**: [#966](https://github.com/ritik4ever/stellar-stream/issues/966)
**Project Area**: `frontend` | **Status**: Implemented

---

## Overview

This document describes the mobile-responsiveness improvements made to the Sender Dashboard to ensure the workflow remains usable on narrow screens (320 px and 768 px) without horizontal clipping of critical amounts or action controls.

## Problem Statement

The Sender dashboard table was not constrained to prevent horizontal overflow on narrow viewports. This caused:

- Amount columns to be clipped or hidden at 320 px
- Action buttons to overflow off-screen, making cancellation impossible without horizontal scrolling
- 56-character Stellar account IDs breaking the layout at narrow widths
- Touch targets smaller than the WCAG minimum of 44 × 44 px

## Solution

### CSS Changes (`frontend/src/index.css`)

| Rule | Purpose |
|------|---------|
| `.sender-streams-table { overflow-x: auto }` | Table wrapper scrolls horizontally instead of clipping at any viewport width |
| `.sender-streams-table table { min-width: 480px }` | Prevents column collapse below natural column widths |
| `.sender-recipient-address { word-break: break-all }` | Long Stellar G-addresses break safely |
| `.sender-action-cell { display: flex; flex-wrap: wrap }` | Action buttons wrap at the smallest viewport |
| `@media (max-width: 768px) .sender-stats-grid { grid-template-columns: repeat(2, 1fr) }` | Stats metrics tile 2-across on mobile |
| `@media (max-width: 320px) .sender-stats-grid { grid-template-columns: 1fr }` | Single-column stats on 320 px |
| `@media (max-width: 768px) .sender-action-cell .btn-ghost { min-height: 44px }` | WCAG touch-target compliance for action buttons |

### Component Changes (`frontend/src/components/SenderDashboard.tsx`)

- Added `className="sender-streams-table"` to the `div.table-wrap` wrappers for both the **Active & Scheduled** table and the **History** table.
- Added `className="sender-stats-grid"` to the stats metrics section.
- Added `className="sender-action-cell"` to `div.action-cell` in table rows.
- Added `className="sender-recipient-address"` to recipient address spans.
- Added `data-label` attributes to all `<td>` elements (future progressive-enhancement hook for card-layout on sub-320 px viewports).

## Viewport Behavior

### 320 px (minimum supported width)

| Concern | Behavior |
|---------|---------|
| Zero-state CTA | Visible and not clipped |
| Stats metrics | Single-column grid |
| Table amounts | Never clipped — wrapper scrolls horizontally |
| Account IDs | Abbreviated in display (`GBX5ZJ…GZ`); raw ID available in `title` attribute |
| Action buttons | `min-height: 44px; min-width: 44px`, stacked vertically |
| Error / Retry banner | Visible at full width; Retry button ≥44 px |

### 768 px (tablet / narrow desktop)

| Concern | Behavior |
|---------|---------|
| Stats metrics | 2-column grid |
| Table amounts | Visible in horizontal scroll wrapper |
| Action buttons | `min-height: 44px` touch-target compliant |
| Account IDs | Abbreviated via `.truncate-address` |

## Touch Target Compliance

All interactive controls in the Sender dashboard meet the WCAG 2.5.5 (AA) minimum of **44 × 44 CSS pixels**:

- Cancel button in table rows: `min-height: 44px; min-width: 44px`
- Edit start-time button: `min-height: 44px; min-width: 44px`
- Retry button on error state: `min-height: 44px`
- Zero-state CTA: `min-height: 44px`

## Edge Cases Handled

| Edge Case | Handling |
|-----------|---------|
| Zero streams at 320 px | Empty state renders CTA button at full width |
| 100+ streams at 320 px | All rows render in scrollable `div.sender-streams-table`; action buttons reachable |
| 56-char Stellar address | Abbreviated in cell; full address in `title` attribute and `aria-label` |
| Recoverable API error (503) | Error banner and Retry button both render at 320 px |
| Stream canceled/completed while modal is open | Background polling (5 s) updates modal to boundary state without re-mount |

## Test Coverage

New test file: `frontend/src/components/SenderDashboardMobile.test.tsx`

| Test | Viewport | Description |
|------|---------|------------|
| Zero-state CTA not clipped | 320 px | `sender-zero-streams` data-testid renders without overflow |
| Table in scrollable wrapper | 320 px | `.sender-streams-table` present in DOM |
| Long address abbreviated | 320 px | Display text shorter than raw 56-char address |
| ≥44 px action touch targets | 320 px | Cancel button inline style verified |
| Amount/action not clipped | 768 px | Amount text and cancel button present |
| 100 streams render | 320 px | All 100 cancel buttons accessible |
| Error banner Retry button | 320 px | Retry button renders with ≥44 px height |

## Files Changed

| File | Change |
|------|--------|
| `frontend/src/index.css` | Added `.sender-streams-table`, `.sender-recipient-address`, `.sender-action-cell`, `.sender-stats-grid` responsive CSS rules |
| `frontend/src/components/SenderDashboard.tsx` | Added `className` and `data-label` attributes to table wrappers and cells |
| `frontend/src/components/SenderDashboardMobile.test.tsx` | **New** — 7 test cases covering 320 px and 768 px viewport behavior |

## Related

- Issue: [#966 \[MOBILE\] Keep Sender dashboard usable on narrow screens](https://github.com/ritik4ever/stellar-stream/issues/966)
- Batch: `SSB-2026-024`
- Cancel modal mobile: `SSB-2026-069` (`CancelConfirmationMobile.test.tsx`)
- Bulk selection mobile: `BulkSelectionMobile.test.tsx`
