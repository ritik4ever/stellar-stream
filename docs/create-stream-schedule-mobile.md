# Create Stream Schedule Mobile Usability Runbook (SSB-2026-009)

## Overview
This runbook documents the mobile adaptations and schedule preview formatting for the `CreateStreamForm` component.

## Schedule and Mobile Specifications
1. **Current-Minute Boundary & Timezone Formatting**:
   - `startInMinutes = 0`: Explicitly announces `Starts immediately (current minute)` along with the UTC end time.
   - `startInMinutes > 0`: Displays both Start and End timestamps in standard UTC format, mitigating device clock or timezone ambiguity.
2. **Narrow Viewport (320px & 768px)**:
   - Schedule preview box applies `overflow-wrap: anywhere; word-break: break-word;` preventing horizontal page stretching.
   - Submit and estimation buttons enforce a minimum 44px height meeting WCAG 2.5.5 / 2.5.8 touch target standards.

## Verification
- Unit test suite: `frontend/src/components/CreateStreamScheduleMobile.test.tsx`.
