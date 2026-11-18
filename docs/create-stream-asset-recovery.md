# Create Stream Asset Picker Recovery Path (SSB-2026-017)

## Problem Overview
During the `Create Stream` workflow, loading the allowed asset list or asset metadata from backend configuration (`/api/config`) may intermittently fail due to RPC or network issues. Previously, users could be stranded without a direct recovery mechanism or risk losing their drafted inputs if forced to refresh the page.

## Recovery Implementation
1. **Actionable Retry:**
   - When asset metadata fails to load, an actionable `Retry Loading Assets` button is exposed alongside the explicit boundary tag `boundary-metadata-failed`.
   - Clicking retry re-triggers the configuration fetch without reloading the page.

2. **Draft & Safe Input Preservation:**
   - Existing form values (sender, recipient, totalAmount, duration, custom asset) are preserved in local component state and autosaved draft storage.
   - When asset metadata succeeds on retry, if the user's selected asset is among the retrieved `allowedAssets`, it remains selected. Otherwise, it gracefully defaults to `USDC` or the first available allowed asset.

3. **Duplicate Submission Prevention:**
   - The retry trigger sets `isFetchingConfig` to true, instantly disabling the retry button and reflecting a `Retrying...` loading indicator.
   - Any secondary clicks while the fetch is in flight are rejected, guaranteeing idempotent recovery.

## Verification
- Unit test suite: `frontend/src/components/CreateStreamAssetRecovery.test.tsx`
  - Verifies actionable retry path and draft input preservation across failure and recovery.
  - Verifies duplicate call prevention during in-flight network requests.
