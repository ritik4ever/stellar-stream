#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# compose-up.sh — start the Docker Compose stack and either reach a verified
# healthy state or stop with a clear rollback.
#
# Phases:
#   1. Preflight   — compose file parses, backend/.env exists.
#   2. Backend     — start redis + backend, poll the container health status.
#   3. Recovery    — on an unhealthy/crashed backend, print diagnostics and
#                    restart it at most MAX_RECOVERY_ATTEMPTS times. Config
#                    errors (env validation failures) are never retried.
#   4. Frontend    — start frontend only once the backend is healthy.
#   5. Rollback    — on any failure, `docker compose down` (volumes are KEPT,
#                    so the SQLite database is never deleted) and exit non-zero.
#
# Exit codes: 0 healthy, 1 unhealthy after recovery (rolled back),
#             2 preflight failed (nothing was started).
#
# Tunables (environment variables):
#   BACKEND_HEALTH_TIMEOUT   seconds to wait for backend healthy   (default 180)
#   FRONTEND_HEALTH_TIMEOUT  seconds to wait for frontend healthy  (default 120)
#   POLL_INTERVAL            seconds between health polls          (default 5)
#   MAX_RECOVERY_ATTEMPTS    backend restarts before rollback      (default 1)
#   MAX_CRASH_RESTARTS       container restarts treated as a crash loop (default 3)
#   BACKEND_PORT             backend port the container healthcheck expects (default 3001)
#   ROLLBACK                 "down" (default) or "keep" to leave containers for debugging
#   COMPOSE_BUILD            "1" (default) passes --build to `up`
# ──────────────────────────────────────────────────────────────────────────────
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

DOCKER="${DOCKER_CMD:-docker}"
COMPOSE_FILE="${COMPOSE_FILE_PATH:-$ROOT_DIR/docker-compose.yml}"
ENV_FILE="${BACKEND_ENV_FILE:-$ROOT_DIR/backend/.env}"
BACKEND_HEALTH_TIMEOUT="${BACKEND_HEALTH_TIMEOUT:-180}"
FRONTEND_HEALTH_TIMEOUT="${FRONTEND_HEALTH_TIMEOUT:-120}"
POLL_INTERVAL="${POLL_INTERVAL:-5}"
MAX_RECOVERY_ATTEMPTS="${MAX_RECOVERY_ATTEMPTS:-1}"
MAX_CRASH_RESTARTS="${MAX_CRASH_RESTARTS:-3}"
BACKEND_PORT="${BACKEND_PORT:-3001}"
ROLLBACK="${ROLLBACK:-down}"
COMPOSE_BUILD="${COMPOSE_BUILD:-1}"

# Pin to the base compose file so the dev override (hot-reload) is not merged in.
compose() { "$DOCKER" compose -f "$COMPOSE_FILE" "$@"; }

log()  { printf '[compose-up] %s\n' "$*"; }
fail() { printf '[compose-up] FAIL: %s\n' "$*" >&2; }

# Log lines emitted by validateEnv()/startServer() that a restart cannot fix.
CONFIG_ERROR_PATTERN='Soroban configuration incomplete|Invalid environment|must be exactly 56 characters|must start with|failed to start server|network configuration mismatch|STELLAR_NETWORK validation failed'

rollback() {
  local reason="$1"
  fail "$reason"
  if [[ "$ROLLBACK" == "keep" ]]; then
    log "ROLLBACK=keep — containers left running for inspection."
    log "Roll back manually with: docker compose down   (do NOT add -v; it deletes the SQLite volume)"
  else
    log "Rolling back: docker compose down (named volume backend-data is preserved)"
    compose down --remove-orphans >/dev/null 2>&1 || fail "docker compose down failed; run it manually"
  fi
  log "RESULT: FAIL — stack rolled back. Fix the cause above, then re-run scripts/compose-up.sh"
  exit 1
}

# Prints "<state> <health> <restart_count>", e.g. "running starting 0".
service_state() {
  local id
  id="$(compose ps -a -q "$1" 2>/dev/null | head -n1)"
  if [[ -z "$id" ]]; then
    echo "missing none 0"
    return
  fi
  "$DOCKER" inspect -f '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{else}}none{{end}} {{.RestartCount}}' "$id" 2>/dev/null \
    || echo "missing none 0"
}

diagnose() {
  local service="$1" id
  log "── diagnostics: $service ──"
  compose ps -a "$service" 2>&1 | sed 's/^/  /'
  id="$(compose ps -a -q "$service" 2>/dev/null | head -n1)"
  if [[ -n "$id" ]]; then
    log "last healthcheck probes:"
    "$DOCKER" inspect -f '{{if .State.Health}}{{range .State.Health.Log}}  exit={{.ExitCode}} {{.Output}}{{end}}{{end}}' "$id" 2>/dev/null | tail -n 6
  fi
  log "last 40 log lines:"
  compose logs --no-color --tail 40 "$service" 2>&1 | sed 's/^/  /'
}

is_config_error() {
  compose logs --no-color --tail 200 "$1" 2>/dev/null | grep -Eq "$CONFIG_ERROR_PATTERN"
}

# ── Configuration preflight ───────────────────────────────────────────────────
# Reads one value from the backend env file without sourcing it (sourcing would
# execute arbitrary shell from the file). Handles `export KEY=VALUE`, trailing
# `# comments`, CRLF line endings and surrounding quotes. Last definition wins.
env_value() {
  local key="$1" file="$2" line value=""
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    line="${line#"${line%%[![:space:]]*}"}"   # trim leading whitespace
    [[ "$line" == "#"* ]] && continue           # comment
    line="${line#export }"                      # allow `export KEY=VALUE`
    [[ "$line" == "$key="* ]] || continue
    value="${line#"$key="}"
    value="${value%%[[:space:]]#*}"             # drop trailing ` # comment`
    value="${value%"${value##*[![:space:]]}"}" # trim trailing whitespace
    value="${value#"${value%%[![:space:]]*}"}" # trim leading whitespace
    value="${value%\"}"; value="${value#\"}"    # strip double quotes
    value="${value%\'}"; value="${value#\'}"    # strip single quotes
  done < "$file"
  printf '%s' "$value"
}

# Safe description of a value for logs: length only, never the value itself.
redact_value() { printf '[%s chars, redacted]' "${#1}"; }

# Fails fast (exit 2, nothing started) when backend/.env cannot produce a
# healthy backend under this Compose file. Never prints secret values.
validate_backend_env() {
  local file="$1" line assignments=0 key value

  # An env file with no assignments cannot satisfy the backend, so the stack
  # would crash-loop and roll back. Catch it before anything is started.
  while IFS= read -r line || [[ -n "$line" ]]; do
    line="${line%$'\r'}"
    line="${line#"${line%%[![:space:]]*}"}"
    [[ -z "${line//[[:space:]]/}" || "$line" == "#"* ]] && continue
    [[ "${line#export }" == *=* ]] && assignments=$(( assignments + 1 ))
  done < "$file"
  if (( assignments == 0 )); then
    fail "backend env file has no settings (empty environment): need SOROBAN_DISABLED=true, or CONTRACT_ID and SERVER_PRIVATE_KEY"
    log "  edit ${file#"$ROOT_DIR"/} (see backend/.env.example) — nothing was started."
    exit 2
  fi

  # Mirrors backend validateEnv(): credentials are required unless Soroban is
  # explicitly disabled. Only presence/format is checked — values are never logged.
  local soroban_disabled
  soroban_disabled="$(printf '%s' "$(env_value SOROBAN_DISABLED "$file")" | tr '[:upper:]' '[:lower:]')"
  if [[ "$soroban_disabled" != "true" ]]; then
    local contract_id server_key
    contract_id="$(env_value CONTRACT_ID "$file")"
    [[ -n "$contract_id" ]] || contract_id="$(env_value STELLAR_CONTRACT_ID "$file")"
    server_key="$(env_value SERVER_PRIVATE_KEY "$file")"
    if [[ -z "$contract_id" || -z "$server_key" ]]; then
      fail "backend Soroban configuration is incomplete: CONTRACT_ID and SERVER_PRIVATE_KEY are both required unless SOROBAN_DISABLED=true"
      log "  set SOROBAN_DISABLED=true in ${file#"$ROOT_DIR"/} for local runs without a deployed contract."
      log "  (credential values are never printed)"
      exit 2
    fi
    if [[ ${#contract_id} -ne 56 || "$contract_id" != C* ]]; then
      fail "CONTRACT_ID is invalid: expected a 56-character contract ID starting with C ($(redact_value "$contract_id"))"
      log "  the placeholder in backend/.env.example is not a real contract ID — replace it or set SOROBAN_DISABLED=true."
      exit 2
    fi
    if [[ ${#server_key} -ne 56 || "$server_key" != S* ]]; then
      fail "SERVER_PRIVATE_KEY is invalid: expected a 56-character secret key starting with S ($(redact_value "$server_key"))"
      log "  the placeholder in backend/.env.example is not a real key — replace it or set SOROBAN_DISABLED=true."
      exit 2
    fi
  fi

  # The healthcheck and published port in docker-compose.yml are fixed at
  # $BACKEND_PORT; a different PORT leaves the container permanently unhealthy.
  local port
  port="$(env_value PORT "$file")"
  if [[ -n "$port" ]]; then
    if [[ ! "$port" =~ ^[0-9]+$ ]]; then
      fail "PORT must be a number (got \"$port\")"
      exit 2
    fi
    if [[ "$port" != "$BACKEND_PORT" ]]; then
      fail "PORT=$port does not match the Compose backend port $BACKEND_PORT used by the container healthcheck and port mapping"
      log "  remove PORT from ${file#"$ROOT_DIR"/} (default 3001) or update docker-compose.yml consistently."
      exit 2
    fi
  fi

  # Anything the backend would reject at startup and crash on.
  for key in RPC_URL SOROBAN_RPC_URL WEBHOOK_DESTINATION_URL; do
    value="$(env_value "$key" "$file")"
    if [[ -n "$value" && ! "$value" =~ ^https?:// ]]; then
      fail "$key must be a valid http(s) URL, e.g. https://host:port/path"
      exit 2
    fi
  done

  # Network selection consistency (issue #1205). Mirrors backend validateEnv():
  # STELLAR_NETWORK picks the profile (testnet default, mainnet via public/main)
  # and the well-known endpoints/passphrases must match it. A mismatch is a
  # configuration error, so it stops with exit 2 instead of crash-looping and
  # relying on the restart/rollback path.
  local network
  network="$(printf '%s' "$(env_value STELLAR_NETWORK "$file")" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"
  case "$network" in
    ""|testnet|test) network="testnet" ;;
    mainnet|public|main) network="mainnet" ;;
    *)
      fail "STELLAR_NETWORK must be \"testnet\" or \"mainnet\" (got \"$(redact_value "$network")\")"
      log "  supported values: testnet (default) or mainnet (aliases: public, main)."
      exit 2
      ;;
  esac
  if [[ "$soroban_disabled" == "true" && ( "$network" == "mainnet" || "$(env_value NODE_ENV "$file" | tr '[:upper:]' '[:lower:]')" == "production" ) ]]; then
    fail "SOROBAN_DISABLED=true is only allowed for non-production testnet runs"
    log "  configure CONTRACT_ID and SERVER_PRIVATE_KEY for production or mainnet."
    exit 2
  fi
  value="$(env_value ALLOWED_ASSETS "$file")"
  if [[ -n "$value" && ! "$value" =~ [A-Za-z0-9] ]]; then
    fail "ALLOWED_ASSETS is set but lists no asset codes (expected e.g. USDC,XLM)"
    exit 2
  fi

  # A fresh SQLite database only persists when it lives in the mounted volume.
  local db_path
  db_path="$(env_value DB_PATH "$file")"
  if [[ -z "$(env_value DATABASE_URL "$file")" && -n "$db_path" ]]; then
    case "$db_path" in
      /app/*|data/*|./data/*) : ;;
      *)
        log "WARNING: DB_PATH=\"$db_path\" is outside the persisted volume /app/data."
        log "         A database created there is a fresh database on every container start."
        log "         Use the default /app/data/streams.db to persist SQLite across restarts."
        ;;
    esac
  fi

  if ! command -v node >/dev/null 2>&1; then
    fail "Node.js is required to validate Stellar network settings before starting Compose"
    exit 2
  fi
  local rpc_preflight_args=(--env-file "$file")
  [[ "$soroban_disabled" == "true" ]] && rpc_preflight_args+=(--skip-connectivity)
  if ! node "$ROOT_DIR/backend/scripts/rpc-preflight.cjs" "${rpc_preflight_args[@]}"; then
    fail "Stellar network/RPC preflight failed; no containers were started"
    exit 2
  fi
}

# Returns 0 healthy, 1 timed out, 3 crashed / crash-looping.
wait_healthy() {
  local service="$1" timeout="$2" elapsed=0 state health restarts baseline
  # RestartCount is cumulative across `compose restart`, so count from here.
  read -r _ _ baseline <<<"$(service_state "$service")"
  while (( elapsed <= timeout )); do
    read -r state health restarts <<<"$(service_state "$service")"
    case "$state/$health" in
      running/healthy)
        log "$service is healthy (${elapsed}s)"
        return 0 ;;
      exited/*|dead/*)
        log "$service container is $state"
        return 3 ;;
    esac
    if (( restarts - baseline >= MAX_CRASH_RESTARTS )); then
      log "$service restarted $(( restarts - baseline )) times — crash loop"
      return 3
    fi
    log "waiting for $service: state=$state health=$health restarts=$restarts (${elapsed}/${timeout}s)"
    sleep "$POLL_INTERVAL"
    elapsed=$(( elapsed + POLL_INTERVAL ))
  done
  return 1
}

# ── 1. Preflight ──────────────────────────────────────────────────────────────
for n in BACKEND_PORT BACKEND_HEALTH_TIMEOUT FRONTEND_HEALTH_TIMEOUT POLL_INTERVAL MAX_RECOVERY_ATTEMPTS MAX_CRASH_RESTARTS; do
  if [[ ! "${!n}" =~ ^[0-9]+$ ]]; then fail "$n must be a non-negative integer"; exit 2; fi
done
if (( POLL_INTERVAL < 1 )); then fail "POLL_INTERVAL must be >= 1"; exit 2; fi
if (( BACKEND_PORT < 1 || BACKEND_PORT > 65535 )); then fail "BACKEND_PORT must be between 1 and 65535"; exit 2; fi
if ! "$DOCKER" compose version >/dev/null 2>&1; then
  fail "docker compose is not available (need Docker Compose v2)"
  exit 2
fi
if [[ ! -f "$ENV_FILE" ]]; then
  fail "missing ${ENV_FILE#"$ROOT_DIR"/} — docker-compose.yml requires it via env_file"
  log "Create it with: cp backend/.env.example backend/.env"
  log "For local runs without a deployed contract, set SOROBAN_DISABLED=true in it."
  exit 2
fi
validate_backend_env "$ENV_FILE"
if ! compose config -q >/dev/null 2>&1; then
  fail "docker-compose.yml is invalid:"
  compose config -q 2>&1 | sed 's/^/  /' >&2
  exit 2
fi
log "preflight OK"

# ── 2. Backend ────────────────────────────────────────────────────────────────
up_args=(up -d)
[[ "$COMPOSE_BUILD" == "1" ]] && up_args+=(--build)

log "starting redis + backend"
if ! compose "${up_args[@]}" redis backend; then
  diagnose backend
  rollback "docker compose up failed for redis/backend"
fi

# ── 3. Recovery loop ──────────────────────────────────────────────────────────
attempt=0
while :; do
  wait_healthy backend "$BACKEND_HEALTH_TIMEOUT"
  rc=$?
  (( rc == 0 )) && break

  diagnose backend
  if is_config_error backend; then
    log "hint: backend rejected its configuration — edit backend/.env (see backend/.env.example)."
    log "hint: for local runs without a contract set SOROBAN_DISABLED=true."
    rollback "backend failed configuration validation; restarting will not help"
  fi
  if (( attempt >= MAX_RECOVERY_ATTEMPTS )); then
    rollback "backend did not become healthy after $attempt recovery attempt(s)"
  fi
  attempt=$(( attempt + 1 ))
  log "recovery attempt $attempt/$MAX_RECOVERY_ATTEMPTS: restarting backend"
  compose restart backend >/dev/null 2>&1 || rollback "docker compose restart backend failed"
done

# ── 4. Frontend ───────────────────────────────────────────────────────────────
log "starting frontend"
if ! compose "${up_args[@]}" frontend; then
  diagnose frontend
  rollback "docker compose up failed for frontend"
fi
if ! wait_healthy frontend "$FRONTEND_HEALTH_TIMEOUT"; then
  diagnose frontend
  rollback "frontend did not become healthy"
fi

log "RESULT: PASS — backend http://localhost:3001/api/health, frontend http://localhost:3000"
exit 0
