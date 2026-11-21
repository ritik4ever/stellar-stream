# Create Stream Recipient Edge & Failure States Runbook (SSB-2026-015)

## Overview
This runbook documents edge case and failure validations for stream recipient specifications in `CreateStreamForm`.

## Specifications

### 1. Malformed Recipient Address Handling
- Stellar addresses must be 56 alphanumeric characters starting with `G`.
- Malformed inputs trigger immediate inline validation warnings (`Account IDs must start with the letter G` or character length hints) and disable form submission.

### 2. Self-Addressed Stream Prevention
- Streams cannot be created where `recipient === sender`.
- When identical, the form surfaces `Recipient cannot be the same as sender` and prevents submission.

### 3. Changed or Disconnected Wallet During Submission
- If the user changes active accounts in their wallet extension or disconnects after fee estimation but prior to clicking `Confirm`, the submission is intercepted safely.
- An alert is rendered (`Connected wallet does not match the stream sender` or `Wallet disconnected`), preventing unintended transactions or wallet authorization mismatches.

## Verification
- Unit test suite: `frontend/src/components/CreateStreamRecipientEdge.test.tsx`
