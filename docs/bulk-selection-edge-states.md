# Bulk Selection Edge and Failure States Test Coverage (SSB-2026-075)

## Overview
This document details the test suite and coverage for the `Bulk selection` workflow (`StreamsTable.tsx` and `SenderDashboard.tsx`), focusing on edge and failure states:
1. `Select-all across a filtered page`
2. `One action in a batch failing`

---

## 1. Targeted Edge Scenarios

### Scenario A: Select-All Across a Filtered Page
- **Boundary Condition:** When a user applies table filters (e.g. status, asset, search terms) and selects all items, only actionable streams within the filtered subset must be selected.
- **Assertion Criteria:**
  - Bulk action bar renders an explicit `Filtered` badge (`data-testid="bulk-filtered-badge"`).
  - Selected count matches the visible selectable items rather than the entire global dataset.
  - Non-cancellable or completed streams are excluded from the selection.
  - When a filtered view contains 0 selectable streams, select-all is safely disabled.

### Scenario B: One Action in a Batch Failing
- **Failure Condition:** In a multi-item batch cancellation (e.g. 3 streams), one stream encounters an RPC/network failure (HTTP 504 / Horizon timeout) while others succeed.
- **Assertion Criteria:**
  - Visible error banner informs the user of partial failure (`1 of N stream(s) could not be canceled`).
  - Succeeded streams are removed from the selection set.
  - Un-canceled/failed streams remain selected so user can inspect and re-attempt.
  - Safe retry button (`data-testid="bulk-cancel-retry-btn"`) re-dispatches ONLY the failed item, guaranteeing zero duplicate transactions for succeeded items.

---

## 2. Test Implementation
- **File:** `frontend/src/components/BulkSelectionEdgeStates.test.tsx`
- **Mocks:** MSW (Mock Service Worker) for deterministic, hermetic HTTP API simulations without relying on live testnet networks.
