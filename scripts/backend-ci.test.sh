#!/usr/bin/env bash
# Tests for scripts/backend-ci.sh. Uses stub test commands, so it needs
# neither a database nor network access and runs in a few seconds.
#
#   bash scripts/backend-ci.test.sh
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT_DIR/scripts/backend-ci.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

passed=0
failed=0

# ── stubs ─────────────────────────────────────────────────────────────────────
mkdir -p "$WORK/bin"

# fake-test: stands in for `npx vitest run ...`. Behaviour per attempt comes from
# $STUB_RUNS, a space-separated list such as "timeout pass".
cat >"$WORK/bin/fake-test" <<'STUB'
#!/usr/bin/env bash
n=$(( $(cat "$STUB_DIR/runs" 2>/dev/null || echo 0) + 1 ))
echo "$n" >"$STUB_DIR/runs"
read -r -a plan <<<"$STUB_RUNS"
outcome="${plan[$(( n - 1 ))]:-${plan[-1]}}"
case "$outcome" in
  pass)
    echo " ✓ src/integration.test.ts (184 tests) 3500ms"
    echo " Test Files  1 passed (1)"
    echo "      Tests  184 passed (184)"
    exit 0
    ;;
  timeout)
    echo " ❯ src/integration.test.ts > Stream Lifecycle > GET /api/streams"
    echo "   → Test timed out in 5000ms."
    exit 1
    ;;
  hook_timeout)
    echo " ❯ src/integration.test.ts > Stream Lifecycle"
    echo "   → Hook timed out in 5000ms."
    exit 1
    ;;
  sqlite_busy)
    echo " ❯ src/integration.test.ts > Stream Lifecycle > POST /api/streams"
    echo "   SqliteError: SQLITE_BUSY: database is locked"
    exit 1
    ;;
  worker_crash)
    echo " VitestProcessError: Worker terminated unexpectedly"
    exit 1
    ;;
  assert)
    echo " ❯ src/integration.test.ts > Stream Lifecycle > GET /api/streams"
    echo "   AssertionError: expected 'USDC' to be 'XLM'"
    echo "   - Expected: 'XLM'"
    echo "   + Received: 'USDC'"
    exit 1
    ;;
  zod_error)
    echo " ❯ src/integration.test.ts > Stream Lifecycle > POST /api/streams"
    echo "   ZodError: ["
    echo "     {"
    echo "       \"code\": \"invalid_type\","
    echo "       \"expected\": \"string\","
    echo "       \"received\": \"number\""
    echo "     }"
    echo "   ]"
    exit 1
    ;;
  hang)
    /bin/sleep 5
    exit 0
    ;;
esac
STUB

# No-op sleep stub for fast testing (the hang case uses /bin/sleep directly).
printf '#!/usr/bin/env bash\nexit 0\n' >"$WORK/bin/sleep"
chmod +x "$WORK/bin/fake-test" "$WORK/bin/sleep"

# run_case <name> <runs> <expected exit> [VAR=value ...]
run_case() {
  local name="$1" runs="$2" expected="$3"
  shift 3
  export STUB_DIR="$WORK/$name"
  mkdir -p "$STUB_DIR/backend/data"
  env PATH="$WORK/bin:$PATH" STUB_RUNS="$runs" \
    BACKEND_DIR="$STUB_DIR/backend" BACKEND_TEST_CMD="fake-test" \
    GITHUB_ACTIONS= \
    "$@" bash "$SCRIPT" >"$STUB_DIR/out" 2>&1
  CASE_RC=$?
  CASE_DIR="$STUB_DIR"
  if (( CASE_RC != expected )); then
    fail_case "$name" "expected exit $expected, got $CASE_RC"
    return 1
  fi
  return 0
}

runs_of() { cat "$CASE_DIR/runs" 2>/dev/null || echo 0; }

fail_case() {
  echo "not ok - $1: $2"
  sed 's/^/    /' "$CASE_DIR/out"
  failed=$(( failed + 1 ))
}
pass_case() { echo "ok - $1"; passed=$(( passed + 1 )); }

# check <name> <description> <command...>
check() {
  local name="$1" what="$2"
  shift 2
  if "$@"; then return 0; fi
  fail_case "$name" "$what"
  return 1
}

# ── cases ─────────────────────────────────────────────────────────────────────
name="passing run passes on the first attempt"
if run_case pass "pass" 0 &&
   check "$name" "PASS line" grep -q "RESULT: PASS" "$CASE_DIR/out" &&
   check "$name" "ran once" test "$(runs_of)" = 1 &&
   check "$name" "not flagged flaky" bash -c "! grep -q 'flaky' '$CASE_DIR/out'"; then
  pass_case "$name"
fi

name="test timeout is retried once and a pass is flagged flaky"
if run_case timeout_then_pass "timeout pass" 0 &&
   check "$name" "ran twice" test "$(runs_of)" = 2 &&
   check "$name" "timeout detected" grep -q "detected flaky failure: Test timed out in 5000ms" "$CASE_DIR/out" &&
   check "$name" "flagged flaky" grep -q "treat as flaky" "$CASE_DIR/out" &&
   check "$name" "PASS line" grep -q "RESULT: PASS" "$CASE_DIR/out"; then
  pass_case "$name"
fi

name="hook timeout is retried once and a pass is flagged flaky"
if run_case hook_timeout_then_pass "hook_timeout pass" 0 &&
   check "$name" "ran twice" test "$(runs_of)" = 2 &&
   check "$name" "timeout detected" grep -q "detected flaky failure: Hook timed out in 5000ms" "$CASE_DIR/out"; then
  pass_case "$name"
fi

name="sqlite_busy error is retried once and a pass is flagged flaky"
if run_case sqlite_busy_then_pass "sqlite_busy pass" 0 &&
   check "$name" "ran twice" test "$(runs_of)" = 2 &&
   check "$name" "sqlite busy detected" grep -q "detected flaky failure: SQLITE_BUSY" "$CASE_DIR/out" &&
   check "$name" "recovery cleaned db" grep -q "cleaning test database state before retry" "$CASE_DIR/out"; then
  pass_case "$name"
fi

name="worker crash is retried once and a pass is flagged flaky"
if run_case worker_crash_then_pass "worker_crash pass" 0 &&
   check "$name" "ran twice" test "$(runs_of)" = 2 &&
   check "$name" "worker crash detected" grep -q "detected flaky failure: VitestProcessError" "$CASE_DIR/out"; then
  pass_case "$name"
fi

name="repeated flaky failures stop after the retry budget with a rollback step"
if run_case timeout_exhausted "timeout" 1 &&
   check "$name" "ran BACKEND_MAX_RETRIES+1 times" test "$(runs_of)" = 2 &&
   check "$name" "budget reported" grep -q "retry budget (BACKEND_MAX_RETRIES=1) exhausted" "$CASE_DIR/out" &&
   check "$name" "rollback printed" grep -q "Rollback: revert the pull request" "$CASE_DIR/out" &&
   check "$name" "FAIL line" grep -q "RESULT: FAIL" "$CASE_DIR/out"; then
  pass_case "$name"
fi

name="assertion failure is not retried"
if run_case assertion "assert pass" 1 &&
   check "$name" "ran once" test "$(runs_of)" = 1 &&
   check "$name" "not-flaky reported" grep -q "not flaky, so it is not retried" "$CASE_DIR/out" &&
   check "$name" "rollback printed" grep -q "Rollback: revert the pull request" "$CASE_DIR/out"; then
  pass_case "$name"
fi

name="schema validation failure is not retried"
if run_case schema_failure "zod_error pass" 1 &&
   check "$name" "ran once" test "$(runs_of)" = 1 &&
   check "$name" "schema error not retried" grep -q "not flaky, so it is not retried" "$CASE_DIR/out" &&
   check "$name" "rollback printed" grep -q "Rollback:" "$CASE_DIR/out"; then
  pass_case "$name"
fi

name="hung run is killed at the hard limit and retried"
if run_case hang "hang pass" 0 BACKEND_RUN_TIMEOUT=1 &&
   check "$name" "hard limit reported" grep -q "hard limit of 1s exceeded" "$CASE_DIR/out" &&
   check "$name" "ran twice" test "$(runs_of)" = 2; then
  pass_case "$name"
fi

name="BACKEND_MAX_RETRIES=0 never retries a timeout"
if run_case no_retry "timeout pass" 1 BACKEND_MAX_RETRIES=0 &&
   check "$name" "ran once" test "$(runs_of)" = 1; then
  pass_case "$name"
fi

# ── preflight cases: exit 2 and no test is run ────────────────────────────────
name="retry budget above the ceiling is rejected"
if run_case over_ceiling "pass" 2 BACKEND_MAX_RETRIES=5 &&
   check "$name" "ceiling reported" grep -q "BACKEND_MAX_RETRIES must be at most 2" "$CASE_DIR/out" &&
   check "$name" "no run" test "$(runs_of)" = 0; then
  pass_case "$name"
fi

name="non-numeric timeout is rejected"
if run_case bad_timeout "pass" 2 BACKEND_RUN_TIMEOUT=abc &&
   check "$name" "no run" test "$(runs_of)" = 0; then
  pass_case "$name"
fi

name="missing backend directory is rejected"
if run_case bad_dir "pass" 2 BACKEND_DIR="$WORK/nonexistent" &&
   check "$name" "missing dir reported" grep -q "backend directory not found" "$CASE_DIR/out" &&
   check "$name" "no run" test "$(runs_of)" = 0; then
  pass_case "$name"
fi

echo
echo "backend-ci tests: $passed passed, $failed failed"
(( failed == 0 ))
