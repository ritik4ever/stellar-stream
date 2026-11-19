# Sender Dashboard Edge and Failure States Runbook (SSB-2026-025)

## Overview
This runbook documents deterministic UI test coverage and safe action verification for the `Sender dashboard` workflow in `SenderDashboard`, targeting empty accounts, massive stream inventories, and recoverable backend failures.

## Specifications

### 1. Zero Streams Boundary Verification
- Verifies that an account with 0 streams displays the explicit empty state (`data-testid="sender-zero-streams"`), showing "No Streams Found".
- Confirms that ready-to-act bulk cancel actions and tabular checkboxes are completely hidden to avoid user confusion.
- Ensures the "Create your first stream" CTA operates correctly.

### 2. Very Large Stream Volume Verification
- Verifies that large datasets ($\ge 50$ streams) render within a bounded container (`max-height: 480px`, `overflow-y: auto`), preventing viewport runaway.
- Asserts presence of the `large-stream-list-badge` ("Large Volume ({count})").
- Confirms that bulk action controls remain safely hidden or unclickable until a user explicitly checks one or more stream rows.

### 3. Recoverable Error & Retry Verification
- Simulates server 500 error responses on `GET /api/streams` using MSW.
- Confirms rendering of the `activity-error` alert card with descriptive messaging.
- Verifies that clicking the "Retry" button dispatches a clean re-fetch without hard page reload.

## Verification
- Test suite: `frontend/src/components/SenderDashboardEdgeStates.test.tsx`
