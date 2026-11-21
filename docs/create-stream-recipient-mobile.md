# Create Stream Recipient Mobile Usability Runbook (SSB-2026-014)

## Overview
This runbook documents mobile responsiveness and layout adaptation for the recipient input and confirmation review step in `CreateStreamForm`.

## Specifications

### 1. Viewport Adaptation (320px & 768px)
- **Review Step Address Display**: Both sender and recipient public keys are displayed during the review step.
- **Word Wrapping**: 56-character Stellar public keys enforce `word-break: break-all` and `overflow-wrap: anywhere`, preventing horizontal clipping or layout blowout on 320px screens.
- **Stacked Layout on Mobile (<480px)**: The `.fee-preview-list` adapts to a stacked column layout on viewports $\le 480$px, ensuring key-value pairs do not crowd horizontally.
- **Critical Data Visibility**: Total amount, stream rate, and network fees remain fully visible and prominent on mobile viewports.

### 2. Action Controls & Touch Targets
- Action controls (`Cancel`, `Confirm`, `Edit`, and `Retry Confirmation`) in the modal enforce a minimum height of 44px, compliant with WCAG 2.5.5 / 2.5.8 touch target standards.

## Verification
- Test suite: `frontend/src/components/CreateStreamRecipientMobile.test.tsx`
