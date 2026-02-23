# Edit Stream Start Time

## Description
This PR implements the ability to edit the start time of a customized, scheduled money stream before it begins vesting. Previously, if users made a mistake with the start time, they were forced to fully cancel the stream and complete the creation flow over again from scratch.

This feature encompasses a new set of targeted updates across the full stack (UI, Service layer, and Backend Controller), adding flexible editing strictly gated to upcoming/scheduled streams.

## Changes Made
### Backend
- **Endpoint:** Added a new `PATCH /api/streams/:id/start-time` endpoint that processes UNIX timestamp updates.
- **Validation:** Enforces strict domain constraints on the server — requests to edit the timestamp of streams that are `active`, `completed`, or `canceled` are safely rejected with HTTP 422 HTTP responses.
- **Swagger:** Full OpenAPI definitions written for the new endpoint in `swagger.ts`.
- **Typing Fixes:** Fixed severe build-blocking TypeScript configuration issues involving Node globally (`process`) and `cors`/`express` type dependencies across the backend.

### Frontend
- **API Client Hook:** Exposed `updateStreamStartAt(id, startAt)` inside `services/api.ts`.
- **Dedicated Modal Component (`EditStartTimeModal.tsx`):**
  - Utilizes native accessible HTML5 `<input type="datetime-local">` to provide a clean date-picker experience that automatically adheres to localized formats.
  - Features real-time validation to restrict timestamps strictly to the future and correctly parses the UNIX epoch behind the scenes.
- **Stream Table Integration (`StreamsTable.tsx`):**
  - Dynamically evaluates each stream and injects an active **✏️ Edit** button alongside the **Cancel** button via a new `action-cell` container pattern.
  - Gated completely to `scheduled` streams so users aren't confused by invalid actions on running streams.
- **App State & Real-time Sync (`App.tsx`):** 
  - Subscribes the modal interface to the core application state loop so streams automatically update and reflect correctly in the global index and tables as soon as a `submit` executes.

## Acceptance Criteria
- [x] Scheduled streams can be updated successfully.
- [x] Active/completed/canceled streams return proper validation error and are impossible to invoke via UI.
- [x] Updated start time appears immediately in the UI.

## Testing Instructions
1. Restart both backend and frontend environments (`npm run dev`).
2. Construct a stream that is scheduled to launch far into the future.
3. Observe that only the scheduled stream allows the `✏️ Edit` button to be pressed from the "Actions" cell inside the central stream table. 
4. Select a new date within the native popup that is closer to the current time, submit, and observe the UI dynamically adjust the record globally in seconds.
5. Attempt backend circumvention by issuing a `PATCH /api/streams/:id/start-time` for a currently `active` or `canceled` stream. Observe the resulting `422` entity validation error returned natively.
