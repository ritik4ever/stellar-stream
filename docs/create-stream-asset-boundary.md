# Create Stream Asset Picker Boundary States Runbook (SSB-2026-016)

## Overview
This runbook covers explicit UX boundary state representations for asset configuration and loading in `CreateStreamForm`.

## Boundary Specifications

### 1. Asset Metadata Load Failure
- When `getConfig()` fails to retrieve the asset list from the backend:
  - Form surfaces an explicit `Asset metadata failed to load` tag (`data-testid="boundary-metadata-failed"`).
  - Activates a fallback text input enabling manual asset symbol entry (`e.g. USDC`).
  - Renders an inline `Retry Loading Assets` button to re-attempt loading without data loss.

### 2. Empty Allowed-Asset Configuration
- When backend returns `allowedAssets: []`:
  - Form surfaces `No allowed assets configured` tag (`data-testid="boundary-empty-assets"`).
  - Submissions are safely guarded to avoid submitting streams with unconfigured tokens.

## Verification
- Test suite: `frontend/src/components/CreateStreamAssetBoundary.test.tsx`
