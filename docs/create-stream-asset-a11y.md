# Create Stream Asset Picker Accessibility (SSB-2026-018)

## Problem Overview
Users relying on screen readers or keyboard navigation require clear, non-intrusive status announcements when selecting or switching assets in the `Create Stream` workflow, especially after draft recovery or page refresh. Furthermore, confirmation prompts and fee review modals must provide explicit row labels for the selected asset code and total amounts.

## Accessibility Enhancements
1. **Focus Order & Field Names:**
   - Both the asset `<select>` element and the fallback `<input>` have accessible labels associated with `htmlFor="stream-asset"` and `aria-label="Asset Code"`.
   - Error states and description hints are properly linked via `aria-describedby` (`asset-error` or `asset-hint`).

2. **Polite Status Announcements:**
   - The current selected asset is rendered within a polite live region (`role="status"`, `aria-live="polite"`).
   - Changes to the asset code update the live region without generating repeated intrusive alert interruptions.

3. **Confirmation Modal Row Semantics:**
   - The fee preview confirmation dialog provides explicit description list items (`<div className="fee-preview-item">`).
   - The selected asset code row features an accessible title (`#review-asset-code-dt`) linked to the value (`data-testid="preview-asset-code" aria-labelledby="review-asset-code-dt"`).
   - The modal supports keyboard dismissal via the `Escape` key and proper focus containment.

## Verification
- Unit test suite: `frontend/src/components/CreateStreamAssetA11y.test.tsx`
  - Validates keyboard selection and status announcement region updates.
  - Verifies accessible dialog attributes and confirmation row labeling for selected asset code and amounts.
  - Verifies keyboard dismissal via `Escape`.
