# Create Stream Amount Mobile Usability Runbook (SSB-2026-004)

## Overview
This runbook covers mobile responsiveness, viewport adaptations, and touch target standards for the amount input and asset selection in `CreateStreamForm`.

## Specifications

### 1. Viewport Adaptation (320px & 768px)
- **Narrow Stacked Layout**: Under narrow mobile viewports ($\le 480$px), form rows adapt to a single column grid, ensuring the Asset Code selector and Total Amount input have 100% available horizontal space.
- **Horizontal Overflow Prevention**: Amount fields, hint messages, and review step rates apply responsive sizing, preventing horizontal scroll or content clipping on screens down to 320px width.

### 2. Touch Target Compliance
- Both `#stream-amount` input and `#stream-asset` selector enforce `min-height: 44px`, satisfying WCAG 2.5.5 / 2.5.8 touch target guidelines for mobile users.

## Verification
- Test suite: `frontend/src/components/CreateStreamAmountMobile.test.tsx`
