# Create Stream Recipient Boundary States Runbook (SSB-2026-011)

## Overview
This runbook covers explicit UX boundary state representations for the recipient field in `CreateStreamForm`.

## Boundary Specifications

### 1. Malformed Recipient Address
- When an input does not conform to the 56-character Stellar public key format starting with `G`:
  - Renders an explicit `Malformed address boundary` tag (`data-testid="boundary-malformed-recipient"`).
  - Keeps form submission disabled to avoid showing a misleading ready-to-act control.

### 2. Self-Addressed Stream Attempt
- When `recipient.trim() === sender.trim()`:
  - Renders an explicit `Self-addressed boundary` tag (`data-testid="boundary-self-addressed"`).
  - Surfaces `Recipient cannot be the same as sender` alert and blocks action dispatch.

## Verification
- Test suite: `frontend/src/components/CreateStreamRecipientBoundary.test.tsx`
