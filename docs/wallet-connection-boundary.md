# Wallet Connection Boundary States Runbook (SSB-2026-076)

## Overview
This runbook documents the explicit UX boundary state handling for the `WalletButton` and wallet connection flow.

## Boundary Cases

### 1. Extension Unavailable (`installed: false`)
- **State Indicator**: Surfaces an explicit boundary tag `Extension unavailable` (`data-testid="boundary-extension-unavailable"`).
- **Action Control**: Renders the `Install Freighter` action with detailed title guidance directing users to install from `freighter.app`.

### 2. Network Passphrase Mismatch
- **Trigger**: When the connected Freighter wallet's network passphrase does not align with the application's configured network (e.g. Freighter on Mainnet instead of Testnet).
- **State Indicator**: Renders an explicit boundary tag `Network passphrase mismatch` (`data-testid="boundary-network-mismatch"`) and error alert.
- **Action Control**: Replaces the misleading active `Connect Wallet` button with a disabled button labeled `Wrong Network (Testnet Required)` with `aria-disabled="true"`. This prevents confusion and avoids triggering failed authentication handshakes until the user switches networks in Freighter.

## Verification
- Unit test suite: `frontend/src/components/WalletConnectionBoundary.test.tsx`
- Component regression tests: `frontend/src/components/WalletButton.test.tsx`
