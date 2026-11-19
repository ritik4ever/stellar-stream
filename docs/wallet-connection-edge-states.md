# Wallet Connection Edge and Failure States Test Coverage (SSB-2026-080)

## Overview
This document outlines the test architecture and coverage for edge and failure states in the `Wallet connection` workflow (`WalletButton.tsx` and `useFreighter.ts`):
1. `Network passphrase mismatch`
2. `Wallet extension being unavailable`

---

## 1. Edge Scenarios & Assertions

### Scenario 1: Network Passphrase Mismatch
- **Condition:** Freighter extension is connected to a different network (e.g. Public Mainnet) than the application expectation (Testnet).
- **Visible State Assertions:**
  - Displays explicit boundary indicator (`data-testid="boundary-network-mismatch"`).
  - Renders user-facing error message in an accessible `role="alert"` element.
  - Primary button shows `Wrong Network (Testnet Required)` and is disabled (`disabled`, `aria-disabled="true"`).
- **Safe Action Behavior:**
  - User cannot trigger stream creation or claims against an incorrect network.
  - Recovery button (`data-testid="wallet-retry-btn"`) allows instant re-connection once the wallet is switched to Testnet.

### Scenario 2: Wallet Extension Unavailable
- **Condition:** Browser does not have the Freighter wallet extension installed or active.
- **Visible State Assertions:**
  - Displays explicit boundary indicator (`data-testid="boundary-extension-unavailable"`).
  - Renders `Install Freighter` guidance button linking to official install documentation.
- **Safe Action Behavior:**
  - An actionable `Retry Connection` button allows instant re-probing without losing current dashboard state or input data.
  - In-flight connecting states safely disable controls with `aria-busy="true"`, preventing duplicate requests.

---

## 2. Test Implementation
- **File:** `frontend/src/components/WalletConnectionEdgeStates.test.tsx`
- **Mocks:** Deterministic, stable component mock states without live Stellar testnet or network dependencies.
