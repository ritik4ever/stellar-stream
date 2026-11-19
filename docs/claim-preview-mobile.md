# Claim Preview Mobile Usability on Narrow Screens (SSB-2026-064)

## Overview
This document specifies the responsive mobile UX and touch target enhancements implemented for the batch `Claim preview` modal (`ClaimBatchModal`) to maintain full functionality and accessibility on narrow viewports down to 320px and 768px tablet widths.

## Requirements & Scope Addressed

1. **Responsive Viewport Wrapping & Clipping Prevention (320px and 768px):**
   - The modal panel container (`.claim-preview-modal-panel`) specifies `maxWidth: "100%"`, `boxSizing: "border-box"`, `overflowWrap: "anywhere"`, and `wordBreak: "break-word"`.
   - Prevents horizontal viewport clipping across all stream amounts, token symbols, boundary notices, and long account / stream IDs.
   - At narrow mobile viewports ($\le 480\text{px}$), modal padding adjusts gracefully to `1rem` and action buttons stack in reverse order to keep primary actions thumb-accessible.

2. **Accessible Touch Targets ($\ge 44\text{px}$):**
   - All interactive modal buttons (`Cancel`, `Confirm claim`, `Confirm partial claim`, `Nothing to claim`, `Retry claim`, `Close`) enforce minimum dimensions of $44\text{px} \times 44\text{px}$ according to WCAG 2.5.5 / 2.5.8 criteria.
   - Modal action button group (`.modal-actions`) utilizes flexible wrapping (`display: flex; flex-wrap: wrap; gap: 0.5rem;`) to eliminate button overlap on narrow viewports.

3. **Boundary & Recovery Layout Safety on Narrow Displays:**
   - **Zero Claimable Balance Notice:** Explicit yellow status box wraps cleanly without breaking viewport bounds and keeps the disabled claim button legible.
   - **Partial Claim Notice:** Displays formatted stream counts and total vested funds with guaranteed text wrapping.
   - **Wallet Signature Rejection & Failures:** Error messages and stream failure lists format long Stellar account IDs and error strings with `word-break: break-all` and `overflow-wrap: anywhere`, accompanied by high-contrast, thumb-sized retry and cancel action controls.

## Verification
- Test Suite: `frontend/src/components/ClaimPreviewMobile.test.tsx`
- Validates 320px and 768px container styles, text wrapping, boundary notice touch targets, wallet rejection retry flow, and completion close controls.
