# Bulk Selection Keyboard and Screen Reader Accessibility (SSB-2026-073)

## Overview
This document outlines the accessibility improvements implemented in the `Bulk selection` workflow (`StreamsTable.tsx` and `SenderDashboard.tsx`) to guarantee full keyboard operability and accessible screen reader notifications.

---

## 1. Problem Statement
Previously, screen readers were not proactively notified of dynamic selection changes, indeterminate checkbox states (`mixed`) were not programmatically exposed via ARIA attributes on select-all inputs, and the bulk action bar lacked landmark role scoping.

---

## 2. Implemented Accessibility Architecture

1. **Explicit Checkbox States (`aria-checked` and `aria-label`):**
   - Header and mobile select-all checkboxes programmatically expose `aria-checked="mixed"` when a subset of visible streams is selected, `aria-checked="true"` when all visible streams are selected, and `aria-checked="false"` when none are selected.
   - Row checkboxes expose explicit `aria-checked={isSelected}` and distinct accessible names (`Select stream <id>`).
   - Appropriate dynamic labels (`Select all <N> visible streams` vs `Deselect all <N> visible streams`).

2. **Landmark Scoping & Polite Live Announcements:**
   - The bulk action floating container is scoped with `role="region"` and `aria-label="Bulk actions"`.
   - The count indicator features `role="status"`, `aria-live="polite"`, and `aria-atomic="true"` to prevent alert spam while keeping assistive technologies informed.
   - An offscreen screen reader live announcement (`data-testid="bulk-selection-announcement"`) announces selection updates across filtered view changes.

3. **Keyboard Operability:**
   - Supports global shortcut `Ctrl+A` / `Cmd+A` to toggle select-all.
   - Supports `Escape` key to clear active selections immediately.
   - Supports `Delete` / `Backspace` keys to trigger bulk cancellation.
   - Standard keyboard focus order traverses through checkboxes, action controls, and the action bar button.

---

## 3. Verification
- **Test File:** `frontend/src/components/BulkSelectionA11y.test.tsx`
- **Coverage:**
  - Verifies `aria-checked="mixed"` on partial selection and `"true"` on complete selection.
  - Verifies screen reader live region announcements without repeated alerts.
  - Verifies landmark roles and accessible action button labels.
  - Verifies keyboard shortcuts (`Ctrl+A`, `Escape`).
