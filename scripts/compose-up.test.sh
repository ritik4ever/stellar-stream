#!/usr/bin/env bash
# Tests for scripts/compose-up.sh. Uses a stub `docker` binary, so it needs
# neither Docker nor network access and runs in a few seconds.
#
#   bash scripts/compose-up.test.sh
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT_DIR/scripts/compose-up.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

passed=0
failed=0

# ── stub docker ───────────────────────────────────────────────────────────────
# Behaviour is driven by $STUB_SCENARIO; every call is appended to $STUB_DIR/calls.
mkdir -p "$WORK/bin"
cat >"$WORK/bin/docker" <<'STUB'
#!/usr/bin/env bash
echo "$*" >>"$STUB_DIR/calls"
counter() { local f="$STUB_DIR/$1"; local n; n=$(( $(cat "$f" 2>/dev/null || echo 0) + 1 )); echo "$n" >"$f"; echo "$n"; }
restarted() { [[ -f "$STUB_DIR/restarted" ]]; }

if [[ "$1" == "inspect" ]]; then
  id="${*: -1}"
  if [[ "$*" == *".State.Health.Log"* ]]; then echo "  exit=1 wget: can't connect"; exit 0; fi
  if [[ "$id" == "frontend-id" ]]; then echo "running healthy 0"; exit 0; fi
  polls=$(counter backend-polls)
  case "$STUB_SCENARIO" in
    healthy)      (( polls >= 2 )) && echo "running healthy 0" || echo "running starting 0" ;;
    unhealthy)    echo "running unhealthy 0" ;;
    recovers)     restarted && echo "running healthy 0" || echo "running unhealthy 0" ;;
    config_error) echo "exited none 0" ;;
    crashloop)    echo "restarting none $polls" ;;
  esac
  exit 0
fi

[[ "$1" == "compose" ]] || exit 1
shift
[[ "$1" == "version" ]] && exit 0
[[ "$1" == "-f" ]] && shift 2
case "$1" in
  config)  exit 0 ;;
  up)      exit 0 ;;
  down)    touch "$STUB_DIR/down" ;;
  restart) touch "$STUB_DIR/restarted" ;;
  ps)      [[ "$*" == *"-q"* ]] && echo "${*: -1}-id" || echo "NAME STATUS" ;;
  logs)
    if [[ "$STUB_SCENARIO" == "config_error" ]]; then
      echo "❌ Soroban configuration incomplete. Either provide both CONTRACT_ID and SERVER_PRIVATE_KEY"
    else
      echo "StellarStream API listening"
    fi ;;
esac
exit 0
STUB
# No-op sleep so polling loops finish instantly.
printf '#!/usr/bin/env bash\nexit 0\n' >"$WORK/bin/sleep"
chmod +x "$WORK/bin/docker" "$WORK/bin/sleep"

# A minimal backend env that passes the configuration preflight: local mode
# needs no Stellar credentials.
write_valid_env() {
  cat >"$1" <<'EOF'
SOROBAN_DISABLED=true
PORT=3001
ALLOWED_ASSETS=USDC,XLM
EOF
}

# run_case <name> <scenario> <expected exit> [VAR=value ...]
run_case() {
  local name="$1" scenario="$2" expected="$3"
  shift 3
  export STUB_DIR="$WORK/$name"
  mkdir -p "$STUB_DIR"
  write_valid_env "$STUB_DIR/env"
  env PATH="$WORK/bin:$PATH" STUB_SCENARIO="$scenario" \
    BACKEND_ENV_FILE="$STUB_DIR/env" \
    BACKEND_HEALTH_TIMEOUT=10 FRONTEND_HEALTH_TIMEOUT=10 POLL_INTERVAL=5 \
    "$@" bash "$SCRIPT" >"$STUB_DIR/out" 2>&1
  CASE_RC=$?
  CASE_DIR="$STUB_DIR"
  if (( CASE_RC != expected )); then
    fail_case "$name" "expected exit $expected, got $CASE_RC"
    return 1
  fi
  return 0
}

fail_case() {
  echo "not ok - $1: $2"
  sed 's/^/    /' "$CASE_DIR/out"
  failed=$(( failed + 1 ))
}
pass_case() { echo "ok - $1"; passed=$(( passed + 1 )); }

# assert <name> <description> <command...>
check() {
  local name="$1" what="$2"
  shift 2
  if "$@"; then return 0; fi
  fail_case "$name" "$what"
  return 1
}

# ── cases ─────────────────────────────────────────────────────────────────────
name="healthy stack passes"
if run_case healthy healthy 0 &&
   check "$name" "PASS line" grep -q "RESULT: PASS" "$CASE_DIR/out" &&
   check "$name" "no rollback" test ! -f "$CASE_DIR/down" &&
   check "$name" "backend started before frontend" \
     bash -c "grep -n ' up ' '$CASE_DIR/calls' | head -1 | grep -q 'redis backend'"; then
  pass_case "$name"
fi

name="missing backend/.env stops before starting anything"
if run_case missing_env healthy 2 BACKEND_ENV_FILE="$WORK/does-not-exist" &&
   check "$name" "hint to copy .env.example" grep -q "cp backend/.env.example backend/.env" "$CASE_DIR/out" &&
   check "$name" "compose up not called" bash -c "! grep -q ' up ' '$CASE_DIR/calls'"; then
  pass_case "$name"
fi

name="persistently unhealthy backend retries once then rolls back"
if run_case unhealthy unhealthy 1 &&
   check "$name" "restarted once" test -f "$CASE_DIR/restarted" &&
   check "$name" "exactly one restart" bash -c "[[ \$(grep -c 'restart backend' '$CASE_DIR/calls') == 1 ]]" &&
   check "$name" "rolled back" test -f "$CASE_DIR/down" &&
   check "$name" "volumes preserved" bash -c "! grep -q 'down.*-v' '$CASE_DIR/calls'" &&
   check "$name" "frontend never started" bash -c "! grep -q 'up.*frontend' '$CASE_DIR/calls'" &&
   check "$name" "FAIL line" grep -q "RESULT: FAIL" "$CASE_DIR/out"; then
  pass_case "$name"
fi

name="backend recovers after one restart"
if run_case recovers recovers 0 &&
   check "$name" "restarted" test -f "$CASE_DIR/restarted" &&
   check "$name" "no rollback" test ! -f "$CASE_DIR/down"; then
  pass_case "$name"
fi

name="config error is not retried"
if run_case config_error config_error 1 &&
   check "$name" "no restart" test ! -f "$CASE_DIR/restarted" &&
   check "$name" "rolled back" test -f "$CASE_DIR/down" &&
   check "$name" "SOROBAN_DISABLED hint" grep -q "SOROBAN_DISABLED=true" "$CASE_DIR/out"; then
  pass_case "$name"
fi

name="crash loop is detected before the timeout"
if run_case crashloop crashloop 1 BACKEND_HEALTH_TIMEOUT=1000 &&
   check "$name" "crash loop reported" grep -q "crash loop" "$CASE_DIR/out" &&
   check "$name" "rolled back" test -f "$CASE_DIR/down"; then
  pass_case "$name"
fi

name="MAX_RECOVERY_ATTEMPTS=0 rolls back without restarting"
if run_case no_retry unhealthy 1 MAX_RECOVERY_ATTEMPTS=0 &&
   check "$name" "no restart" test ! -f "$CASE_DIR/restarted"; then
  pass_case "$name"
fi

name="ROLLBACK=keep leaves containers running"
if run_case keep unhealthy 1 ROLLBACK=keep &&
   check "$name" "down not called" test ! -f "$CASE_DIR/down" &&
   check "$name" "manual rollback printed" grep -q "Roll back manually" "$CASE_DIR/out"; then
  pass_case "$name"
fi

# ── configuration preflight cases ─────────────────────────────────────────────
# Every case below must stop with exit 2 and never call `compose up`, so no
# partial rollout happens for an unusable environment.

name="empty backend/.env fails preflight without starting anything"
cat >"$WORK/empty.env" <<'EOF'
# no settings here yet
EOF
if run_case empty_env healthy 2 BACKEND_ENV_FILE="$WORK/empty.env" &&
   check "$name" "empty environment reported" grep -q "empty environment" "$CASE_DIR/out" &&
   check "$name" "compose up not called" bash -c "! grep -q ' up ' '$CASE_DIR/calls'"; then
  pass_case "$name"
fi

name="missing Soroban credentials fail preflight without starting anything"
cat >"$WORK/no-soroban.env" <<'EOF'
ALLOWED_ASSETS=USDC,XLM
PORT=3001
EOF
if run_case no_soroban healthy 2 BACKEND_ENV_FILE="$WORK/no-soroban.env" &&
   check "$name" "incomplete config reported" grep -q "Soroban configuration is incomplete" "$CASE_DIR/out" &&
   check "$name" "hint to disable Soroban" grep -q "SOROBAN_DISABLED=true" "$CASE_DIR/out" &&
   check "$name" "compose up not called" bash -c "! grep -q ' up ' '$CASE_DIR/calls'"; then
  pass_case "$name"
fi

name="invalid credentials fail without leaking their values"
cat >"$WORK/bad-keys.env" <<'EOF'
CONTRACT_ID=SECRETPLACEHOLDERCONTRACTVALUE
SERVER_PRIVATE_KEY=SECRETPLACEHOLDERKEYVALUE
EOF
if run_case bad_keys healthy 2 BACKEND_ENV_FILE="$WORK/bad-keys.env" &&
   check "$name" "invalid CONTRACT_ID reported" grep -q "CONTRACT_ID is invalid" "$CASE_DIR/out" &&
   check "$name" "contract value redacted" bash -c "! grep -q 'SECRETPLACEHOLDERCONTRACTVALUE' '$CASE_DIR/out'" &&
   check "$name" "secret value redacted" bash -c "! grep -q 'SECRETPLACEHOLDERKEYVALUE' '$CASE_DIR/out'" &&
   check "$name" "compose up not called" bash -c "! grep -q ' up ' '$CASE_DIR/calls'"; then
  pass_case "$name"
fi

name="PORT mismatch with the Compose healthcheck port fails preflight"
cat >"$WORK/bad-port.env" <<'EOF'
SOROBAN_DISABLED=true
PORT=5000
EOF
if run_case bad_port healthy 2 BACKEND_ENV_FILE="$WORK/bad-port.env" &&
   check "$name" "mismatch reported" grep -q "does not match the Compose backend port" "$CASE_DIR/out" &&
   check "$name" "compose up not called" bash -c "! grep -q ' up ' '$CASE_DIR/calls'"; then
  pass_case "$name"
fi

name="SOROBAN_DISABLED=true passes preflight without credentials"
if run_case local_mode healthy 0 &&
   check "$name" "stack reached healthy" grep -q "RESULT: PASS" "$CASE_DIR/out"; then
  pass_case "$name"
fi

name="DB_PATH outside the persisted volume warns but still starts"
cat >"$WORK/db-outside.env" <<'EOF'
SOROBAN_DISABLED=true
DB_PATH=backend/data/streams.db
EOF
if run_case db_outside healthy 0 BACKEND_ENV_FILE="$WORK/db-outside.env" &&
   check "$name" "persistence warning printed" grep -q "outside the persisted volume" "$CASE_DIR/out" &&
   check "$name" "stack still started" grep -q "RESULT: PASS" "$CASE_DIR/out"; then
  pass_case "$name"
fi

echo
echo "compose-up tests: $passed passed, $failed failed"
(( failed == 0 ))
