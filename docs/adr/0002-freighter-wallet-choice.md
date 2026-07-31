# ADR 0002: Why Freighter Over Other Wallets

**Status:** Accepted  
**Date:** 2026-07-29  
**Deciders:** Stellar Stream Team

## Context

StellarStream needs a browser wallet integration for user-initiated on-chain actions, especially claim flows and any future signed approvals. The wallet choice affects onboarding, platform support, and how much custom wiring the frontend needs.

## Problem

We need a wallet integration that:

- Works well in a browser-based MVP
- Has a low-friction connection flow
- Supports the Stellar ecosystem directly
- Is familiar to users already on Stellar
- Keeps the frontend implementation maintainable

## Options Considered

### Option 1: Freighter (Chosen)

**Pros:**

- Widely used Stellar wallet with direct ecosystem fit
- Clean browser-extension-based workflow
- Good developer experience for sign-and-submit flows
- Matches the current frontend wallet UI already in the repo
- Keeps user keys in the wallet instead of the app

**Cons:**

- Requires the browser extension to be installed
- Users without the extension need an install path

### Option 2: Generic Wallet Connect Layer

**Pros:**

- Could support multiple wallets behind one interface
- Future-proof if the wallet ecosystem expands

**Cons:**

- More moving parts for the MVP
- Extra abstraction before we know which wallets matter most
- More integration and QA work across wallets

### Option 3: Server-Signed Custodial Flow

**Pros:**

- Simplest user onboarding
- No wallet setup required for the user

**Cons:**

- Breaks the non-custodial model
- Raises trust and security concerns
- Not aligned with the intended user ownership model

## Decision

**We choose Freighter as the primary wallet integration for the MVP.**

### Rationale

1. **Best Stellar Fit:** Freighter is purpose-built for Stellar users and aligns with the ecosystem's common wallet flow.
2. **Lowest User Friction for the MVP:** The app only needs one well-defined browser wallet path rather than a generic compatibility layer.
3. **Frontend Simplicity:** The existing code already centers Freighter hooks and UI, so the implementation stays focused.
4. **Non-Custodial by Default:** Users keep control of their own signing keys.

## Consequences

### Positive

- Clear wallet UX for the first release
- Smaller surface area for wallet bugs
- Easier onboarding for Stellar-native users
- Better alignment with user-owned signing

### Negative

- Freighter becomes a dependency for on-chain actions
- Users on unsupported browsers need an install step
- Future multi-wallet support will require additional abstraction

## Alternatives Considered

### Alternative 1: Support Every Wallet Immediately

Rejected because it adds complexity before we know which wallet diversity matters in practice.

### Alternative 2: Custodial Signing

Rejected because it shifts trust from the user to the server and does not match the product direction.

## References

- Frontend wallet hook: `frontend/src/hooks/useFreighter.ts`
- Wallet UI: `frontend/src/components/WalletButton.tsx`
- Claim flow: `frontend/src/services/soroban.ts`
- Freighter documentation: https://freighter.app/
