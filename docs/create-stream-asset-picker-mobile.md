# Create Stream Asset Picker Mobile Usability Runbook (SSB-2026-019)

## Overview
This runbook documents mobile responsiveness, narrow-screen layout adaptation, and accessibility enhancements for the `Create stream asset picker` workflow in `CreateStreamForm`.

## Specifications

### 1. Viewport Adaptation (320px & 768px)
- **Asset Input & Select Controls**: `#stream-asset` (`<select>` when allowed assets are configured, and `<input>` fallback) adapts cleanly to narrow screens with `width: 100%`, `max-width: 100%`, and `box-sizing: border-box`.
- **Selected Asset Hint**: The `#asset-hint` element enforces `word-break: break-all`, `overflow-wrap: anywhere`, and `display: block` to ensure long custom asset codes (e.g. 12-character alphanumeric Stellar assets) do not overflow or cause horizontal scrollbars on 320px screens.
- **Boundary State Indicators**: Both `.asset-boundary-tag--empty` ("No allowed assets configured") and `.asset-boundary-tag--failed` ("Asset metadata failed to load") utilize `word-break: break-word` and `max-width: 100%` for clean wrapping.
- **Header & Retry Layout**: The label header wraps gracefully with `flex-wrap: wrap` and `gap: 0.35rem`, preventing collision between the label and the "Retry Loading Assets" action button.

### 2. Action Controls & Touch Targets
- Both the `<select>` dropdown and fallback `<input>` field enforce a minimum height of 44px (`minHeight: "44px"`), compliant with WCAG 2.5.5 / 2.5.8 touch target standards.
- Action controls ("Create Stream", "Retry Loading Assets") provide tactile, accessible tap areas for mobile and tablet users.

## Verification
- Test suite: `frontend/src/components/CreateStreamAssetPickerMobile.test.tsx`
