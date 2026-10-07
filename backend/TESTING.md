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
-  Filter by status (scheduled, active, completed, canceled)
- ✅ Filter by sender
- ✅ Filter by recipient
-  Filter by asset
- ✅ Search by query string
- ✅ Pagination (page, limit)
- ✅ Validation errors (invalid status, page, limit)

#### GET /api/streams/:id
- ✅ Get specific stream
- ✅ 404 for non-existent stream
- ✅ 400 for invalid stream ID

#### GET /api/recipients/:accountId/streams
- ✅ Get streams for recipient
-  Empty array for recipient with no streams
- ✅ 400 for invalid account ID

#### GET /api/senders/:accountId/streams
- ✅ Get streams for sender
-  Filter by status
-  Pagination
-  400 for invalid account ID

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
-  Filter by event type
- ✅ Pagination
-  400 for invalid event type

### 5. Export Functionality

#### GET /api/streams/export.csv
- ✅ Export all streams as CSV
-  Filter by status
-  Filter by asset
- ✅ Filter by sender
- ✅ Correct CSV format and headers

### 6. Error Handling
- ✅ Craceful handling of database errors
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

## Backend CI Configuration

The `Backend CI` workflow (`.github/workflows/backend-ci.yml`) runs the
unit, typecheck, and integration jobs. The configuration it reads is validated
before any job starts so an invalid setting fails fast with a useful,
non-sensitive error and no partial rollout.

### Required settings

| Setting | Used by | Required values |
| --- | --- | --- |
| `NODE_ENV` | all jobs | `development`, `test`, `production` |
| `DATABASE_URL` | integration | a non-empty SQLite or Postgres URL |
| `API_BASE_URL` | integration | an http(s) URL |
| `LOG_LEVEL` | all jobs | `debug`, `info`, `warn`, `error` |
| `CI_PARALLELISM` | all jobs | a positive integer |

### Validating locally

Run the validator before pushing a workflow change:

```bash
cd backend
npm run validate:ci-config
```

The validator reports the name of the offending setting and the accepted
values. It never echoes the value of a secret and redacts any credential it
detects in a URL, so the output is safe to share in a ticket or a CI log.

### Running the validator tests

```bash
cd backend
ncm test -- src/ci/validateConfig.test.ts

```

The tests cover the happy path, every invalid value, missing settings, and
the redaction guarantee for secrets.
