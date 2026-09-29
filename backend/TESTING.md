# Backend Integration Tests

This document describes the comprehensive integration test suite for the StellarStream backend API.

## Overview

The integration tests cover all major REST API flows including:
- Stream lifecycle (create, list, get, cancel)
- Filtering and pagination
- Event history tracking
- Export functionality
- Error handling

## Test Database

Tests use a separate SQLite database (`test-streams.db`) to ensure:
- No interference with development data
- Clean state for each test
- Isolated test environment

The test database is automatically:
- Created before tests run
- Cleaned between each test
- Deleted after all tests complete

## Running Tests

```bash
# Run all tests
npm test

# Run integration tests only
npm test integration.test.ts

# Run tests in watch mode
npm test -- --watch

# Run tests with coverage
npm test -- --coverage
```

## Test Coverage

### 1. Health Check
- ✅ Service status endpoint

### 2. Stream Lifecycle

#### GET /api/streams
- ✅ List all streams
- ✅ Filter by status (scheduled, active, completed, canceled)
- ✅ Filter by sender
- ✅ Filter by recipient
- ✅ Filter by asset
- ✅ Search by query string
- ✅ Pagination (page, limit)
- ✅ Validation errors (invalid status, page, limit)

#### GET /api/streams/:id
- ✅ Get specific stream
- ✅ 404 for non-existent stream
- ✅ 400 for invalid stream ID

#### GET /api/recipients/:accountId/streams
- ✅ Get streams for recipient
- ✅ Empty array for recipient with no streams
- ✅ 400 for invalid account ID

#### GET /api/senders/:accountId/streams
- ✅ Get streams for sender
- ✅ Filter by status
- ✅ Pagination
- ✅ 400 for invalid account ID

### 3. Stream History

#### GET /api/streams/:id/history
- ✅ Get event history for stream
- ✅ 404 for non-existent stream

#### GET /api/streams/:id/snapshot
- ✅ Get stream with history
- ✅ 404 for non-existent stream

### 4. Global Events

#### GET /api/events
- ✅ List all events
- ✅ Filter by event type
- ✅ Pagination
- ✅ 400 for invalid event type

### 5. Export Functionality

#### GET /api/streams/export.csv
- ✅ Export all streams as CSV
- ✅ Filter by status
- ✅ Filter by asset
- ✅ Filter by sender
- ✅ Correct CSV format and headers

### 6. Error Handling
- ✅ Graceful handling of database errors
- ✅ Proper error messages and status codes

## Test Structure

Each test suite follows this pattern:

```typescript
describe("Feature", () => {
  beforeEach(() => {
    // Setup test data
  });

  it("should handle expected behavior", async () => {
    const response = await request(app).get("/api/endpoint");
    expect(response.status).toBe(200);
    // Additional assertions
  });

  it("should handle error cases", async () => {
    const response = await request(app).get("/api/invalid");
    expect(response.status).toBe(400);
    // Error assertions
  });
});
```

## Key Features

### Isolated Test Environment
- Uses separate test database
- No impact on development data
- Clean state between tests

### Comprehensive Coverage
- Happy path scenarios
- Error cases
- Edge cases
- Validation errors

### Real HTTP Requests
- Uses supertest for actual HTTP calls
- Tests full request/response cycle
- Validates headers, status codes, and body

### Database Integration
- Tests actual database operations
- Verifies data persistence
- Tests transactions and constraints

## Adding New Tests

When adding new endpoints or features:

1. Add test data setup in `beforeEach`
2. Test happy path first
3. Add error case tests
4. Test edge cases
5. Verify validation

Example:

```typescript
describe("New Feature", () => {
  beforeEach(() => {
    // Insert test data
  });

  it("should handle valid request", async () => {
    const response = await request(app)
      .post("/api/new-endpoint")
      .send({ data: "valid" });
    
    expect(response.status).toBe(201);
    expect(response.body.data).toBeDefined();
  });

  it("should reject invalid request", async () => {
    const response = await request(app)
      .post("/api/new-endpoint")
      .send({ data: "invalid" });
    
    expect(response.status).toBe(400);
    expect(response.body.error).toBeDefined();
  });
});
```

## Continuous Integration

These tests are designed to run in CI/CD pipelines:
- Fast execution
- No external dependencies
- Deterministic results
- Clean setup and teardown

## Troubleshooting

### Tests Failing Locally

1. Ensure dependencies are installed: `npm install`
2. Check that no other process is using the test database
3. Verify environment variables are not interfering

### Database Locked Errors

If you see "database is locked" errors:
- Ensure previous test runs completed
- Delete `backend/data/test-streams.db` manually
- Restart the test suite

### Port Conflicts

Tests use the Express app directly (no port binding), so port conflicts should not occur.

## Future Enhancements

Potential additions to the test suite:
- [ ] Authentication flow tests
- [x] Webhook delivery tests (see Webhook Monitoring Smoke Check)
- [x] Secrets rotation verification (see Secrets Rotation Smoke Check)
- [ ] Concurrent request handling
- [ ] Performance benchmarks
- [ ] Load testing

## Webhook Monitoring Smoke Check

`src/services/webhookQueueStats.test.ts` is a repeatable smoke check for the
webhook monitoring workflow. It drives the real queue worker against a real
SQLite database (`axios` is mocked, so nothing touches the network) and then
asserts the pending, retry and dead-letter counts through
`evaluateWebhookMonitoring()`, which returns an explicit pass/fail verdict
instead of a bare number.

```bash
cd backend
npx vitest run src/services/webhookQueueStats.test.ts
```

### Checklist

Run this before releasing a change to `webhook.ts`, `webhookWorker.ts`, the
webhook migrations, or the queue schema.

| # | Scenario | What to confirm | Expected result |
| --- | --- | --- | --- |
| 1 | Bursty delivery queue | 25 deliveries become due at once | Queue drains: `pending: 0`, `delivered: 25`, `deadLetters: 0` |
| 2 | Destination remains unavailable | The receiver refuses every attempt | Retry scheduled while the budget lasts (`pending: 1`, `scheduledRetries: 1`), then `deadLetters: 1` once the budget is exhausted |
| 3 | Verdict has teeth | Expectation deliberately mismatched | `pass: false`, with the failing checks named |
| 4 | Empty queue invariants | No deliveries at all | `pass: true`; `pending == dueNow + scheduledRetries` and `total == pending + delivered + deadLetters` |

A red run means the queue no longer behaves the way the monitoring signal
assumes — investigate before trusting the webhook health signal in production.

The check prints only counts, never payloads, stream IDs, or the destination
URL, so its output is safe to keep in a CI log.

## Secrets Rotation Smoke Check

`src/services/secrets-rotation.smoke.test.ts` is a repeatable smoke check for the
secrets rotation procedures documented in
[../RUNBOOK.md](../RUNBOOK.md#verify-secrets-rotation-smoke-check). It boots the
real Express app twice — once with the current `JWT_SECRET` /
`SERVER_SIGNING_KEY`, once with the rotated credentials — so the run reproduces
the restart an operator performs, including the window where old and new
instances overlap during a rolling deploy.

```bash
cd backend
npm run smoke:rotation
# from the repository root: npm run test:secrets-rotation
```

No running service, no network access and no real credential are required: the
secrets are throwaway values generated for the run, and each instance uses its
own temporary SQLite file.

### Checklist

Run this before releasing a change to `auth.ts`, the JWT/challenge routes, or a
change to the documented rotation procedure in `RUNBOOK.md`.

| # | Scenario | What to confirm | Expected result |
| --- | --- | --- | --- |
| 1 | Baseline | Old credentials before rotation | Old JWT verifies and is accepted; the challenge carries the old server key's signature |
| 2 | Rollout window — old credential | Token issued before rotation sent to the rotated instance | `401 invalid_token` |
| 3 | Rollout window — new credential | Token issued after rotation sent to the not-yet-rotated instance | `401 invalid_token` (a mixed fleet cannot share sessions) |
| 4 | Rollout window — old challenge | Challenge signed by the old server key sent to the rotated instance | Rejected with `Challenge verification failed` |
| 5 | Cutover time | Restart until the old credential is rejected | Printed as `cutover time`, within the 30 s budget |
| 6 | Signature cutover | New JWT and new challenge verified against both credential sets | Verify with the new secret/key succeeds, verification with the old one fails |
| 7 | Verdict | Overall result | `RESULT: PASS (14/14 checks)`, exit code `0` |

A red run means rotation no longer behaves the way `RUNBOOK.md` documents —
fix that before trusting the procedure in production. The report contains only
timings, HTTP statuses and pass/fail, so its output is safe to keep in a CI log.
