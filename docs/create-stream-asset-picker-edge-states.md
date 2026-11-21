# Create Stream Asset Picker Edge and Failure States Runbook (SSB-2026-020)

## Overview
This runbook documents edge case and failure state coverage for the `Create stream asset picker` workflow in `CreateStreamForm`, addressing dynamic list shifts, empty configurations, and network failures during asset metadata retrieval.

## Specifications

### 1. Empty Allowed-Asset Configuration
- When the backend configuration endpoint returns an empty `allowedAssets` array (`[]`), the asset picker displays an explicit status tag (`data-testid="boundary-empty-assets"`) reading "No allowed assets configured".
- The UI gracefully falls back to a text input field with placeholder `e.g. USDC` and enforces standard form validation so users are not blocked.

### 2. Changed Allowed-Asset List Transition
- When the allowed asset set changes between renders or on reload, the component validates the currently selected asset against the new list:
  - If the previously selected asset is invalid, it re-defaults to `"USDC"` if present.
  - If `"USDC"` is not present, it re-defaults to the first allowed asset in the list (`allowedAssets[0]`).
  - If the list becomes empty, it allows manual text entry.

### 3. Asset Metadata Failure and Safe Action Recovery
- If the configuration fetch rejects with a network or server error (`Error("Asset metadata failed to load")`), the component surfaces:
  - An error indicator (`data-testid="boundary-metadata-failed"`) with clear error copy.
  - An accessible retry button (`data-testid="retry-asset-config"`) allowing the user to re-trigger `getConfig()` without losing existing form draft values.
- Safe action behavior: Form submission remains gated by validation, ensuring unconfirmed or blank assets cannot execute transactions against the network.

## Verification
- Test suite: `frontend/src/components/CreateStreamAssetPickerEdgeStates.test.tsx`
