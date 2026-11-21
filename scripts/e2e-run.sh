#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# e2e-run.sh — run the Playwright browser tests and either reach a verified
# passing state or stop with a clear rollback step (issue #1190).
#
# Phases:
#   1. Preflight   — tunables are valid and the stack (backend health endpoint
#                    and frontend) answers. Nothing is run against a dead stack.
#   2. Run         — `npm run test:e2e` under a hard wall-clock limit, so a hung
#                    browser can never consume the whole CI job.
#   3. Detection   — a failed run is classified as a TIMEOUT (hard limit hit,
#                    Playwright test/action/navigation timeout, browser launch
#                    timeout) or a TEST FAILURE (assertion, including web-first
#                    `expect` timeouts, or any other error).
#   4. Recovery    — only timeouts are retried, at most E2E_MAX_RETRIES times,
#                    and only after the stack re-passes its health check.
#                    Test failures are never retried: a retry would hide a real
#                    regression in the components/styles under review.
#   5. Result      — PASS (a pass after a retry is flagged as flaky), or FAIL
#                    with the reports kept and the rollback step printed.
#
# Exit codes: 0 passed, 1 test failure or timeouts exhausted,
#             2 preflight failed (no browser test was run).
#
# Tunables (environment variables):
#   E2E_RUN_TIMEOUT      hard limit per attempt in seconds          (default 600)
#   E2E_MAX_RETRIES      extra attempts after a timeout, max 2      (default 1)
#   E2E_HEALTH_TIMEOUT   seconds to wait for the stack per check    (default 60)
#   POLL_INTERVAL        seconds between health polls               (default 5)
#   BACKEND_HEALTH_URL   default http://localhost:3001/api/health
#   FRONTEND_URL         default http://localhost:3000
#   E2E_CMD              test command, run in frontend/  (default npm run test:e2e)
# ──────────────────────────────────────────────────────────────────────────────
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONTEND_DIR="${E2E_FRONTEND_DIR:-$ROOT_DIR/frontend}"

E2E_RUN_TIMEOUT="${E2E_RUN_TIMEOUT:-600}"
E2E_MAX_RETRIES="${E2E_MAX_RETRIES:-1}"
E2E_HEALTH_TIMEOUT="${E2E_HEALTH_TIMEOUT:-60}"
POLL_INTERVAL="${POLL_INTERVAL:-5}"
BACKEND_HEALTH_URL="${BACKEND_HEALTH_URL:-http://localhost:3001/api/health}"
FRONTEND_URL="${FRONTEND_URL:-http://localhost:3000}"
E2E_CMD="${E2E_CMD:-npm run test:e2e}"

# Retrying more than twice turns a timeout budget into a way to wait out a
# genuinely broken build, so the ceiling is fixed here rather than tunable.
MAX_RETRIES_CEILING=2

log()  { printf '[e2e-run] %s\n' "$*"; }
fail() { printf '[e2e-run] FAIL: %s\n' "$*" >&2; }

# Playwright messages that mean "ran out of time", not "asserted wrong".
# `expect(...)` timeouts ("Timed out 5000ms waiting for expect") are
# deliberately excluded: they are how web-first assertions fail.
TIMEOUT_PATTERN='Test timeout of [0-9]+ms exceeded|Timeout [0-9]+ms exceeded|Global timeout of [0-9]+ms exceeded|browserType\.launch: Timeout'

stop() {
  local reason="$1"
  fail "$reason"
  log "Reports kept in frontend/playwright-report* (uploaded as the playwright-report artifact in CI)."
  log "Rollback: tear the stack down with  docker compose down --volumes --remove-orphans"
  log "          and do not merge the change under test until this job is green."
  log "RESULT: FAIL"
  exit 1
}

# Returns 0 once both the backend health endpoint and the frontend answer.
wait_stack_healthy() {
  local elapsed=0
  while (( elapsed <= E2E_HEALTH_TIMEOUT )); do
    if curl --silent --fail --max-time 5 "$BACKEND_HEALTH_URL" >/dev/null 2>&1 &&
       curl --silent --fail --max-time 5 "$FRONTEND_URL" >/dev/null 2>&1; then
      log "stack is healthy (${elapsed}s)"
      return 0
    fi
    log "waiting for stack: $BACKEND_HEALTH_URL and $FRONTEND_URL (${elapsed}/${E2E_HEALTH_TIMEOUT}s)"
    sleep "$POLL_INTERVAL"
    elapsed=$(( elapsed + POLL_INTERVAL ))
  done
  return 1
}

# Keeps an attempt's HTML report so a retry does not overwrite the evidence.
keep_report() {
  local attempt="$1"
  if [[ -d "$FRONTEND_DIR/playwright-report" ]]; then
    rm -rf "$FRONTEND_DIR/playwright-report-attempt-$attempt"
    cp -r "$FRONTEND_DIR/playwright-report" "$FRONTEND_DIR/playwright-report-attempt-$attempt"
    log "report for attempt $attempt kept in frontend/playwright-report-attempt-$attempt"
  fi
}

# ── 1. Preflight ──────────────────────────────────────────────────────────────
for n in E2E_RUN_TIMEOUT E2E_MAX_RETRIES E2E_HEALTH_TIMEOUT POLL_INTERVAL; do
  if [[ ! "${!n}" =~ ^[0-9]+$ ]]; then fail "$n must be a non-negative integer"; exit 2; fi
done
if (( POLL_INTERVAL < 1 )); then fail "POLL_INTERVAL must be >= 1"; exit 2; fi
if (( E2E_RUN_TIMEOUT < 1 )); then fail "E2E_RUN_TIMEOUT must be >= 1"; exit 2; fi
if (( E2E_MAX_RETRIES > MAX_RETRIES_CEILING )); then
  fail "E2E_MAX_RETRIES must be at most $MAX_RETRIES_CEILING (got $E2E_MAX_RETRIES)"
  exit 2
fi
if [[ ! -d "$FRONTEND_DIR" ]]; then fail "frontend directory not found: $FRONTEND_DIR"; exit 2; fi
if ! wait_stack_healthy; then
  fail "stack is not healthy before the browser tests — no test was run"
  log "Start it with scripts/compose-up.sh (or docker compose up -d --build) and retry."
  exit 2
fi
log "preflight OK"

# ── 2–4. Run, detect, recover ─────────────────────────────────────────────────
attempt=0
timeouts=0
while :; do
  attempt=$(( attempt + 1 ))
  out="$(mktemp)"
  log "attempt $attempt/$(( E2E_MAX_RETRIES + 1 )): $E2E_CMD (hard limit ${E2E_RUN_TIMEOUT}s)"
  ( cd "$FRONTEND_DIR" && timeout --kill-after=30 "$E2E_RUN_TIMEOUT" bash -c "$E2E_CMD" ) 2>&1 | tee "$out"
  rc=${PIPESTATUS[0]}

  if (( rc == 0 )); then
    rm -f "$out"
    if (( timeouts > 0 )); then
      log "WARNING: passed only after $timeouts timed-out attempt(s) — treat as flaky and investigate."
      [[ -n "${GITHUB_ACTIONS:-}" ]] && echo "::warning title=Flaky browser tests::Playwright passed on attempt $attempt after $timeouts timeout(s)"
    fi
    log "RESULT: PASS"
    exit 0
  fi

  keep_report "$attempt"
  if (( rc == 124 || rc == 137 )); then
    kind="hard limit of ${E2E_RUN_TIMEOUT}s exceeded"
  elif grep -Eq "$TIMEOUT_PATTERN" "$out"; then
    kind="$(grep -Eo "$TIMEOUT_PATTERN" "$out" | head -n1)"
  else
    rm -f "$out"
    stop "browser tests failed (exit $rc) — not a timeout, so it is not retried"
  fi
  rm -f "$out"

  timeouts=$(( timeouts + 1 ))
  log "detected timeout: $kind"
  if (( attempt > E2E_MAX_RETRIES )); then
    stop "browser tests timed out on $timeouts attempt(s); retry budget (E2E_MAX_RETRIES=$E2E_MAX_RETRIES) exhausted"
  fi
  log "re-checking stack health before retrying"
  if ! wait_stack_healthy; then
    stop "stack became unhealthy after a timeout — retrying against it would not be meaningful"
  fi
done
