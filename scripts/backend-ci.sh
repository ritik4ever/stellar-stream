#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# backend-ci.sh — run the Backend CI tests and either reach a verified
# passing state or stop with a clear rollback step (issue #1185).
#
# Phases:
#   1. Preflight   — validate tunables (non-negative integers, retry ceiling),
#                    confirm the backend directory exists, and clean up any
#                    stale test database files.
#   2. Run         — run the backend test command under a hard wall-clock limit
#                    so a hung runner cannot consume the entire CI job.
#   3. Detection   — classify failures into:
#                    - FLAKY: runner timeouts, transient SQLite lock contention
#                      (SQLITE_BUSY/LOCKED), or worker process crashes.
#                    - DETERMINISTIC: schema errors (Zod validation failures),
#                      contract assertion failures, or syntax/type errors.
#   4. Recovery    — retries only flaky failures, at most BACKEND_MAX_RETRIES times
#                    (default 1, ceiling 2). Before retrying, cleans up test
#                    database files and locks to ensure a clean state.
#                    Deterministic test failures (assertions, schema errors)
#                    are NEVER retried to prevent masking real API/schema breaks.
#   5. Result      — PASS (a pass after retry is flagged as flaky), or FAIL
#                    with rollback steps printed.
#
# Exit codes: 0 passed, 1 test failure or retries exhausted,
#             2 preflight failed (no test was run).
#
# Tunables (environment variables):
#   BACKEND_RUN_TIMEOUT   hard limit per attempt in seconds (default 300)
#   BACKEND_MAX_RETRIES   extra attempts after flaky failure, max 2 (default 1)
#   BACKEND_DIR           path to backend directory (default: repo root/backend)
#   BACKEND_TEST_CMD      test command to run in backend/
# ──────────────────────────────────────────────────────────────────────────────
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BACKEND_DIR="${BACKEND_DIR:-$ROOT_DIR/backend}"

BACKEND_RUN_TIMEOUT="${BACKEND_RUN_TIMEOUT:-300}"
BACKEND_MAX_RETRIES="${BACKEND_MAX_RETRIES:-1}"
BACKEND_TEST_CMD="${BACKEND_TEST_CMD:-npx vitest run --coverage --coverage.thresholds.lines=80 --coverage.thresholds.branches=80}"

# Ceiling prevents retries from being used to wait out a genuinely broken build.
MAX_RETRIES_CEILING=2

log()  { printf '[backend-ci] %s\n' "$*"; }
fail() { printf '[backend-ci] FAIL: %s\n' "$*" >&2; }

# Patterns indicating flaky or transient failures eligible for bounded retry
FLAKY_PATTERN='Test timed out in [0-9]+ms|Hook timed out in [0-9]+ms|timed out after [0-9]+ms|TimeoutError|SQLITE_BUSY|SQLITE_LOCKED|database is locked|VitestProcessError|Worker terminated unexpectedly|resource temporarily unavailable|EBUSY'

# Patterns indicating deterministic test or schema failures that must NEVER be retried
DETERMINISTIC_PATTERN='AssertionError|ZodError|expected .* to (be|equal|match)|Expected:|Received:|schema validation failed'

stop() {
  local reason="$1"
  fail "$reason"
  log "Rollback: revert the pull request or commit under test and do not merge until this job is green."
  log "          Clean test database artifacts with: rm -f backend/data/test-*.db*"
  log "RESULT: FAIL"
  exit 1
}

cleanup_test_artifacts() {
  if [[ -d "$BACKEND_DIR/data" ]]; then
    rm -f "$BACKEND_DIR/data"/test-*.db "$BACKEND_DIR/data"/test-*.db-wal "$BACKEND_DIR/data"/test-*.db-shm 2>/dev/null || true
  fi
  rm -f "$BACKEND_DIR"/test-*.db "$BACKEND_DIR"/test-*.db-wal "$BACKEND_DIR"/test-*.db-shm 2>/dev/null || true
}

# ── 1. Preflight ──────────────────────────────────────────────────────────────
for n in BACKEND_RUN_TIMEOUT BACKEND_MAX_RETRIES; do
  if [[ ! "${!n}" =~ ^[0-9]+$ ]]; then fail "$n must be a non-negative integer"; exit 2; fi
done

if (( BACKEND_RUN_TIMEOUT < 1 )); then fail "BACKEND_RUN_TIMEOUT must be >= 1"; exit 2; fi
if (( BACKEND_MAX_RETRIES > MAX_RETRIES_CEILING )); then
  fail "BACKEND_MAX_RETRIES must be at most $MAX_RETRIES_CEILING (got $BACKEND_MAX_RETRIES)"
  exit 2
fi

if [[ ! -d "$BACKEND_DIR" ]]; then fail "backend directory not found: $BACKEND_DIR"; exit 2; fi

# Clean up any lingering test databases from prior runs
cleanup_test_artifacts
log "preflight OK"

# ── 2–4. Run, detect, recover ─────────────────────────────────────────────────
attempt=0
flaky_count=0

while :; do
  attempt=$(( attempt + 1 ))
  out="$(mktemp)"
  log "attempt $attempt/$(( BACKEND_MAX_RETRIES + 1 )): $BACKEND_TEST_CMD (hard limit ${BACKEND_RUN_TIMEOUT}s)"
  ( cd "$BACKEND_DIR" && timeout --kill-after=30 "$BACKEND_RUN_TIMEOUT" bash -c "$BACKEND_TEST_CMD" ) 2>&1 | tee "$out"
  rc=${PIPESTATUS[0]}

  if (( rc == 0 )); then
    rm -f "$out"
    cleanup_test_artifacts
    if (( flaky_count > 0 )); then
      log "WARNING: passed only after $flaky_count flaky attempt(s) — treat as flaky and investigate."
      [[ -n "${GITHUB_ACTIONS:-}" ]] && echo "::warning title=Flaky backend integration test::Backend tests passed on attempt $attempt after $flaky_count flaky failure(s)"
    fi
    log "RESULT: PASS"
    exit 0
  fi

  # Classification of failure:
  # 1. Deterministic failure (assertions, schema/Zod validation failures) must NEVER be retried
  if grep -Eq "$DETERMINISTIC_PATTERN" "$out"; then
    rm -f "$out"
    cleanup_test_artifacts
    stop "backend tests failed with assertion or schema error (exit $rc) — not flaky, so it is not retried"
  fi

  # 2. Check for flaky/transient timeout or SQLite lock contention
  if (( rc == 124 || rc == 137 )); then
    kind="hard limit of ${BACKEND_RUN_TIMEOUT}s exceeded"
  elif grep -Eq "$FLAKY_PATTERN" "$out"; then
    kind="$(grep -Eo "$FLAKY_PATTERN" "$out" | head -n1)"
  else
    rm -f "$out"
    cleanup_test_artifacts
    stop "backend tests failed (exit $rc) — not a recognized flaky failure, so it is not retried"
  fi
  rm -f "$out"

  flaky_count=$(( flaky_count + 1 ))
  log "detected flaky failure: $kind"

  if (( attempt > BACKEND_MAX_RETRIES )); then
    cleanup_test_artifacts
    stop "backend tests failed on $flaky_count attempt(s); retry budget (BACKEND_MAX_RETRIES=$BACKEND_MAX_RETRIES) exhausted"
  fi

  log "recovery: cleaning test database state before retry"
  cleanup_test_artifacts
done
