# Cancel Confirmation Boundary State Handling (SSB-2026-066)

## Overview
This document specifies the boundary state design and implementation for the `Cancel confirmation` workflow in `SenderDashboard.tsx`. It provides clear distinctions between active streams eligible for cancellation and already finalized (canceled or completed) streams to prevent showing misleading ready-to-act destructive controls.

---

## 1. Problem Statement
Previously, when the cancel confirmation dialog was rendered, if a stream was already finalized (`status === "canceled"` or `status === "completed"`), the modal header still posed the prompt `Cancel stream?` and rendered a primary action button labeled `Yes, cancel stream` (even if disabled). This presented an ambiguous ready-to-act UI state that suggested cancellation was still possible or necessary.

---

## 2. Explicit Boundary States

### Active Stream (Normal Confirmation Path)
- **Modal Header:** `Cancel stream?` (`data-testid="cancel-modal-title"`).
- **Prompt:** Displays explicit irreversible action warning and refundable remainder (`data-testid="cancel-refundable-amount"`).
- **Primary Action:** Destructive button `Yes, cancel stream` (`data-testid="cancel-confirm-btn"`), enabled and wired to `confirmCancelStream()`.
- **Secondary Action:** `Keep stream` (`data-testid="cancel-dismiss-btn"`).

### Already Canceled Stream (Boundary Path)
- **Modal Header:** `Stream already canceled` (`data-testid="cancel-modal-title"`).
- **Status Notice:** Explicit status container (`data-testid="cancel-boundary-notice"`) with `role="status"` informing the user that the stream is already canceled and unvested funds were refunded.
- **Primary Action:** Disabled non-actionable badge labeled `Already canceled` (`aria-disabled="true"`), eliminating misleading submit affordances.
- **Secondary Action:** Informative `Close` button (`data-testid="cancel-dismiss-btn"`).

### Already Completed Stream (Boundary Path)
- **Modal Header:** `Stream already completed` (`data-testid="cancel-modal-title"`).
- **Status Notice:** Container (`data-testid="cancel-boundary-notice"`) with `role="status"` clarifying that 100% of stream funds have vested and been claimed.
- **Primary Action:** Disabled badge labeled `Already completed` (`aria-disabled="true"`).
- **Secondary Action:** `Close` button.

---

## 3. Verification
- **Test Suite:** `frontend/src/components/CancelConfirmationBoundary.test.tsx`
- **Coverage:**
  - Active stream dialog rendering and confirmation dispatch.
  - State transition handling to already canceled stream with disabled non-actionable button.
  - State transition handling to already completed stream with explanatory boundary text.
