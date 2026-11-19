# Wallet Connection Keyboard and Screen Reader Accessibility (SSB-2026-078)

## Overview
This document specifies accessibility standards and keyboard/screen reader integration for the `Wallet connection` workflow (`WalletButton.tsx`), supporting account switches, accessible naming, and polite status announcements.

---

## 1. Problem Statement
Previously, wallet connection state transitions (such as switching accounts in Freighter or connecting/disconnecting) were only visually indicated. Assistive technology users did not receive immediate status announcements when an account changed, and the truncated address badge lacked keyboard focusability and accessible labeling.

---

## 2. Implemented Accessibility Architecture

1. **Focus Management and Accessible Naming:**
   - The connected address badge provides `tabIndex={0}` and an explicit `aria-label="Connected wallet address: <FULL_PUBLIC_KEY>"`, allowing keyboard and screen reader users to inspect the full address.
   - The Disconnect button carries an accessible name including the targeted truncated address: `aria-label="Disconnect wallet <GABC…WXYZ>"`.

2. **Polite Screen Reader Announcements (`role="status"`):**
   - Uses an offscreen live region (`role="status"`, `aria-live="polite"`, `aria-atomic="true"`, `data-testid="wallet-status-announcement"`).
   - Dynamically announces:
     - Initial connection: `Wallet connected: <GABC…WXYZ>`
     - Account switch: `Wallet account switched to <GDEF…1234>`
     - Disconnection: `Wallet disconnected`
     - In-flight connection: `Connecting to wallet…`
   - Avoids repetitive alert spam (`role="alert"` is reserved solely for error conditions).

3. **In-Flight Connecting State:**
   - During active connection attempts, the button exposes `aria-busy="true"` and `disabled={true}`, ensuring clear screen reader feedback and preventing duplicate connection triggers.

---

## 3. Verification
- **Test File:** `frontend/src/components/WalletConnectionA11y.test.tsx`
- **Coverage:**
  - Asserts focusability and accessible label on connected address badge.
  - Verifies polite status announcements on initial connect, account switch, and disconnect.
  - Asserts keyboard operability for disconnect and connection retry.
  - Verifies `aria-busy` and disabled state during connecting.
