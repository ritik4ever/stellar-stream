# Wallet Connection Recovery Path (SSB-2026-077)

## Overview
This document specifies the recovery path implemented for the `Wallet connection` workflow (`WalletButton.tsx` and `useFreighter.ts`), ensuring reliable user remediation when the wallet extension is unavailable or connection attempts encounter network errors.

---

## 1. Problem Statement
Previously, if the Freighter extension was missing or a connection attempt failed, the UI indicated an error or missing extension but lacked an immediate in-situ retry button. Users had to reload the entire web page to re-trigger extension detection, risking loss of form inputs and stream configurations.

---

## 2. Implemented Recovery Mechanisms

1. **Actionable In-Situ Retry (`data-testid="wallet-retry-btn"`):**
   - When `!installed` or `error` occurs, an explicit `Retry Connection` button is rendered alongside install and connect controls.
   - Users can install or unlock their extension and click `Retry Connection` directly without page reloads.

2. **Useful Failure Messaging:**
   - Simulated or runtime errors are rendered in an accessible `role="alert"` container.
   - Specific failure messages distinguish user cancellations ("Connection cancelled — please approve the request in Freighter"), timeouts, and network passphrase mismatches.

3. **Duplicate Request Prevention:**
   - While `status === "connecting"`, all trigger controls transition to a disabled state (`aria-busy="true"`).
   - In-flight duplicate clicks are safely prevented.

4. **Network Passphrase Mismatch Handling:**
   - When a network passphrase mismatch is detected, the primary button indicates `Wrong Network (Testnet Required)` and remains safely disabled.
   - The recovery `Retry Connection` button allows instant re-validation once the user updates their network in the Freighter extension popup.

---

## 3. Verification
- **Test File:** `frontend/src/components/WalletConnectionRecovery.test.tsx`
- **Coverage:**
  - Verifies presence and click behavior of actionable retry button when extension is unavailable.
  - Asserts useful alert message rendering on simulated connection failure.
  - Asserts duplicate action prevention during in-flight connecting state.
  - Verifies network passphrase mismatch boundary state and retry workflow.
