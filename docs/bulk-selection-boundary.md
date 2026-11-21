# Bulk Selection Boundary State Handling (SSB-2026-071)

## Overview
This document specifies the boundary state handling in the Bulk Selection workflow (`StreamsTable.tsx` and `SenderDashboard.tsx`) for `select-all across a filtered page` and mixed actionable stream states.

---

## 1. Problem Statement
Previously, triggering `Select all` on a filtered table view produced a generic count without clarifying that only the currently filtered subset was selected. Furthermore, when a filtered page contained only un-cancellable or completed streams, select-all checkboxes remained enabled and could present an ambiguous ready-to-act control when no actionable streams were selected.

---

## 2. Boundary Clarifications

1. **Filtered View Scope Indication:**
   - When filters (`status`, `asset`, `search`, `sender`, `recipient`) are active, the Bulk Action Bar renders a prominent `Filtered` indicator (`data-testid="bulk-filtered-badge"`).
   - Clarifies that the action applies strictly to selected streams within the current filtered scope rather than the global unfiltered dataset.

2. **Zero Actionable Streams Boundary:**
   - If a filtered page contains only non-cancellable streams (e.g. `status === "completed"` or `status === "canceled"`), `selectableStreams.length === 0`.
   - The select-all checkbox is disabled (`disabled={loading || selectableStreams.length === 0}`) with descriptive label `No selectable streams on this page`.
   - Prevents rendering an inert or misleading ready-to-act bulk action bar.

3. **Accurate Actionable Count Affordance:**
   - The primary action button displays the exact actionable count: `Cancel X Stream(s)` (`data-testid="bulk-cancel-action-btn"`).
   - In `SenderDashboard.tsx`, an explicit selection scope notice (`data-testid="bulk-selection-scope-notice"`) allows 1-click clearing of selections across views.

---

## 3. Verification
- **Test File:** `frontend/src/components/BulkSelectionBoundary.test.tsx`
- **Coverage:**
  - Verifies filtered view scope indicator and badge.
  - Verifies disabled state and label when 0 actionable streams exist on page.
  - Verifies dynamic count updates on individual row selections.
