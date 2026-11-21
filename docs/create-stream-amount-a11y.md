# Create Stream Amount Keyboard & Screen Reader Accessibility Runbook (SSB-2026-003)

## Overview
This runbook documents accessibility (A11Y) implementations for the amount input, asset selector, and confirmation review in `CreateStreamForm`.

## Specifications

### 1. Keyboard Navigation & Focus Order
- Strict linear tab sequence: Sender $\to$ Recipient $\to$ Asset Code $\to$ Total Amount $\to$ Duration $\to$ Start In $\to$ Cliff $\to$ Submit Button.
- Asset selector and amount field are fully operable via Tab, Shift+Tab, Arrow keys, and Enter.

### 2. Screen Reader & ARIA Semantics
- Amount input links to `amount-hint` via `aria-describedby` with `aria-live="polite"`, preventing repeated disruptive alert interrupts while typing.
- Validation errors map via `aria-invalid="true"` and `role="alert"`, announcing error boundaries accurately.
- In the confirmation modal, the amount and selected asset are presented as semantic descriptive terms (`<dt>` / `<dd>`) and the modal overlay supports keyboard dismissal via the `Escape` key.

## Verification
- Test suite: `frontend/src/components/CreateStreamAmountA11y.test.tsx`
