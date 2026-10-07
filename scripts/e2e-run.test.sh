#!/usr/bin/env bash
# Tests for scripts/e2e-run.sh. Uses stub `curl` and test commands, so it needs
# neither a browser, Docker nor network access and runs in a few seconds.
#
#   bash scripts/e2e-run.test.sh
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT_DIR/scripts/e2e-run.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

passed=0
failed=0

# ── stubs ─────────────────────────────────────────────────────────────────────
# curl: healthy unless $STUB_HEALTH says otherwise. `after_first_run` turns the
# stack unhealthy once the fake test command has run.
mkdir -p "$WORK/bin"
cat >"$WORK/bin/curl" <<'STUB'
#!/usr/bin/env bash
echo "curl $*" >>"$STUB_DIR/calls"
case "${STUB_HEALTH:-up}" in
  up)              exit 0 ;;
  down)            exit 7 ;;
  after_first_run) [[ -f "$STUB_DIR/runs" ]] && exit 7 || exit 0 ;;
esac
STUB

# fake-e2e: stands in for `npm run test:e2e`. Behaviour per attempt comes from
# $STUB_RUNS, a space-separated list such as "timeout pass".
cat >"$WORK/bin/fake-e2e" <<'STUB'
#!/usr/bin/env bash
n=$(( $(cat "$STUB_DIR/runs" 2>/dev/null || echo 0) + 1 ))
echo "$n" >"$STUB_DIR/runs"
read -r -a plan <<<"$STUB_RUNS"
outcome="${plan[$(( n - 1 ))]:-${plan[-1]}}"
mkdir -p playwright-report && echo "attempt $n" >playwright-report/index.html
case "$outcome" in
  pass)    echo "  2 passed (3.1s)"; exit 0 ;;
  timeout) echo "  1) home.spec.ts › homepage loads"; echo "    Test timeout of 60000ms exceeded."; exit 1 ;;
  action)  echo "    Error: page.goto: Timeout 15000ms exceeded."; exit 1 ;;
  expect)  echo "    Error: Timed out 5000ms waiting for expect(locator).toHaveText(expected)"; exit 1 ;;
  assert)  echo "    Expected: \"StellarStream\""; echo "    Received: \"Stellar\""; exit 1 ;;
  hang)    /bin/sleep 5; exit 0 ;;
esac
STUB
# No-op sleep so health polling finishes instantly (the hang case uses /bin/sleep).
printf '#!/usr/bin/env bash\nexit 0\n' >"$WORK/bin/sleep"
chmod +x "$WORK/bin/curl" "$WORK/bin/fake-e2e" "$WORK/bin/sleep"

# run_case <name> <runs> <expected exit> [VAR=value ...]
run_case() {
  local name="$1" runs="$2" expected="$3"
  shift 3
  export STUB_DIR="$WORK/$name"
  mkdir -p "$STUB_DIR/frontend"
  env PATH="$WORK/bin:$PATH" STUB_RUNS="$runs" \
    E2E_FRONTEND_DIR="$STUB_DIR/frontend" E2E_CMD="fake-e2e" \
    E2E_HEALTH_TIMEOUT=10 POLL_INTERVAL=5 GITHUB_ACTIONS= \
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
   check "$name" "timeout detected" grep -q "detected timeout: Test timeout of 60000ms exceeded" "$CASE_DIR/out" &&
   check "$name" "flagged flaky" grep -q "treat as flaky" "$CASE_DIR/out" &&
   check "$name" "first report kept" test -f "$CASE_DIR/frontend/playwright-report-attempt-1/index.html"; then
  pass_case "$name"
fi

name="action/navigation timeout counts as a timeout"
if run_case action_timeout "action pass" 0 &&
   check "$name" "ran twice" test "$(runs_of)" = 2; then
  pass_case "$name"
fi

name="repeated timeouts stop after the retry budget with a rollback step"
if run_case timeout_exhausted "timeout" 1 &&
   check "$name" "ran E2E_MAX_RETRIES+1 times" test "$(runs_of)" = 2 &&
   check "$name" "budget reported" grep -q "retry budget (E2E_MAX_RETRIES=1) exhausted" "$CASE_DIR/out" &&
   check "$name" "rollback printed" grep -q "Rollback: tear the stack down" "$CASE_DIR/out" &&
   check "$name" "FAIL line" grep -q "RESULT: FAIL" "$CASE_DIR/out"; then
  pass_case "$name"
fi

name="assertion failure is not retried"
if run_case assertion "assert pass" 1 &&
   check "$name" "ran once" test "$(runs_of)" = 1 &&
   check "$name" "not-a-timeout reported" grep -q "not a timeout, so it is not retried" "$CASE_DIR/out" &&
   check "$name" "rollback printed" grep -q "Rollback:" "$CASE_DIR/out"; then
  pass_case "$name"
fi

name="expect() timeout is an assertion failure and is not retried"
if run_case expect_timeout "expect pass" 1 &&
   check "$name" "ran once" test "$(runs_of)" = 1; then
  pass_case "$name"
fi

name="hung run is killed at the hard limit and retried"
if run_case hang "hang pass" 0 E2E_RUN_TIMEOUT=1 &&
   check "$name" "hard limit reported" grep -q "hard limit of 1s exceeded" "$CASE_DIR/out" &&
   check "$name" "ran twice" test "$(runs_of)" = 2; then
  pass_case "$name"
fi

name="E2E_MAX_RETRIES=0 never retries a timeout"
if run_case no_retry "timeout pass" 1 E2E_MAX_RETRIES=0 &&
   check "$name" "ran once" test "$(runs_of)" = 1; then
  pass_case "$name"
fi

name="unhealthy stack after a timeout stops instead of retrying"
if run_case unhealthy_after "timeout pass" 1 STUB_HEALTH=after_first_run &&
   check "$name" "ran once" test "$(runs_of)" = 1 &&
   check "$name" "unhealthy reported" grep -q "stack became unhealthy after a timeout" "$CASE_DIR/out"; then
  pass_case "$name"
fi

# ── preflight cases: exit 2 and no browser test is run ────────────────────────
name="unhealthy stack fails preflight without running tests"
if run_case down "pass" 2 STUB_HEALTH=down &&
   check "$name" "no run" test "$(runs_of)" = 0 &&
   check "$name" "hint printed" grep -q "scripts/compose-up.sh" "$CASE_DIR/out"; then
  pass_case "$name"
fi

name="retry budget above the ceiling is rejected"
if run_case over_ceiling "pass" 2 E2E_MAX_RETRIES=5 &&
   check "$name" "ceiling reported" grep -q "E2E_MAX_RETRIES must be at most 2" "$CASE_DIR/out" &&
   check "$name" "no run" test "$(runs_of)" = 0; then
  pass_case "$name"
fi

name="non-numeric timeout is rejected"
if run_case bad_timeout "pass" 2 E2E_RUN_TIMEOUT=ten &&
   check "$name" "no run" test "$(runs_of)" = 0; then
  pass_case "$name"
fi

echo
echo "e2e-run tests: $passed passed, $failed failed"
(( failed == 0 ))
