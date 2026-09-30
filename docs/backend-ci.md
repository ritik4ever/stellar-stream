# Backend CI: Handling Failures and Flaky Integration Tests

This runbook covers how the **Backend CI** workflow
(`.github/workflows/backend-ci.yml`) handles test runs on pull requests
modifying the API, database schema, or routes, distinguishing between
flaky integration test failures and deterministic contract regressions.

## Overview

When pull requests modify API endpoints, Zod validation schemas, or database
migrations, Backend CI executes linting, type-checking, and the full test suite
with code coverage.

[`scripts/backend-ci.sh`](../scripts/backend-ci.sh) wraps test execution to
safely detect transient/flaky test runner or locking failures while ensuring
that real regressions (such as broken API contracts or schema validation errors)
fail immediately with a clear rollback step.

## What runs

| Phase | Behaviour |
|-------|-----------|
| **Preflight** | Validates configuration tunables (non-negative integers, retry ceiling `MAX_RETRIES_CEILING=2`), verifies the backend directory exists, and cleans up any leftover test database files (`test-*.db*`). Exits `2` on preflight failure without running tests. |
| **Run** | Executes the test command under a hard wall-clock timeout (`BACKEND_RUN_TIMEOUT`, default 300s in CI) so hung runners or workers cannot stall the entire CI job. |
| **Detection** | Classifies any non-zero exit as either **flaky/transient** or **deterministic failure** (see below). |
| **Recovery** | Retries only flaky failures, at most `BACKEND_MAX_RETRIES` times (1 in CI, ceiling 2). Before each retry, test databases and locks are cleaned to guarantee a clean state. Deterministic failures are never retried. |
| **Result** | Either `RESULT: PASS` (exit `0`), or `RESULT: FAIL` (exit `1`) with a clear rollback step. A pass after retry logs a warning and posts a GitHub `::warning` annotation. |

---

### What counts as flaky / transient

A failed run is eligible for retry **only** if it matches one of these transient conditions:

- **Hard limit exceeded**: process killed by wall-clock timeout (exit `124` or `137`).
- **Test/hook runner timeout**: `Test timed out in Nms`, `Hook timed out in Nms`, `timed out after Nms`, or `TimeoutError`.
- **Database lock contention**: `SQLITE_BUSY: database is locked`, `SQLITE_LOCKED`, or `database is locked` under concurrency.
- **Worker termination / resource contention**: `VitestProcessError`, `Worker terminated unexpectedly`, or `resource temporarily unavailable` (`EBUSY`).

### What counts as a deterministic failure (never retried)

Any failure containing:

- **Schema validation errors**: `ZodError`, `invalid_type`, `unrecognized_keys`, or schema mismatch.
- **Assertion failures**: `AssertionError`, `expected ... to be`, `Expected:`, `Received:`, or contract expectation breaks.
- **Syntax / Typecheck / Compilation errors**: Type errors, missing exports, or unhandled exceptions in endpoint logic.

These indicate a real breaking change or regression in the API/schema modification under review. Retrying them would risk masking legitimate bugs or slowing down CI feedback.

---

## Safe retry boundaries

- **Strict retry limit**: At most 1 retry in CI (`BACKEND_MAX_RETRIES=1`), with a hard ceiling of 2 across all environments. Setting `BACKEND_MAX_RETRIES=0` disables retries completely.
- **Clean recovery before retry**: Leftover `test-*.db`, `test-*.db-wal`, and `test-*.db-shm` files are removed before re-running tests so stale locks or half-written rows cannot contaminate the retry.
- **Flaky detection visibility**: If a test succeeds on retry, the job remains green but logs:
  ```
  WARNING: passed only after 1 flaky attempt(s) — treat as flaky and investigate.
  ```
  and outputs a GitHub Actions warning annotation (`::warning title=Flaky backend integration test::...`).
- **Clear rollback on failure**: When retries are exhausted or a deterministic failure occurs, execution halts immediately with `RESULT: FAIL` and instructions.

---

## Rollback

When the script ends with `RESULT: FAIL`:

1. **Do not merge the pull request**: The branch contains either a broken API/schema contract or a persistently failing test.
2. **Revert or fix the offending commit**:
   - If an assertion or Zod error failed, check whether the API response format or schema definition changed unexpectedly.
   - If a test timed out repeatedly, investigate slow queries, missing indexes, or unclosed handles.
3. **Clean local test databases**:
   ```bash
   rm -f backend/data/test-*.db*
   ```
4. **Inspect coverage and logs**: Download the `coverage-report` artifact or review CI job logs for failure specifics.

---

## Running locally

```bash
# Run backend CI test procedure locally
npm run backend:ci

# Run with custom tunables
BACKEND_MAX_RETRIES=1 BACKEND_RUN_TIMEOUT=120 bash scripts/backend-ci.sh

# Run unit tests for the backend CI script itself
npm run test:backend-ci
```

### Tunables

| Variable | Default | Meaning |
|----------|---------|---------|
| `BACKEND_RUN_TIMEOUT` | `300` | Hard wall-clock limit per attempt, in seconds |
| `BACKEND_MAX_RETRIES` | `1` | Extra attempts allowed after a flaky failure (maximum 2) |
| `BACKEND_DIR` | `repo_root/backend` | Path to backend working directory |
| `BACKEND_TEST_CMD` | `npx vitest run --coverage --coverage.thresholds.lines=80 --coverage.thresholds.branches=80` | Test command to execute |

The procedure is tested by `scripts/backend-ci.test.sh`, which uses stubs and requires no database or network dependencies.
