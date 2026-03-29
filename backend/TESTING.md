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
- [ ] Webhook delivery tests
- [ ] Concurrent request handling
- [ ] Performance benchmarks
- [ ] Load testing
