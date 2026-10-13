#!/usr/bin/env bash
# Tests for scripts/verify-deployment.sh. Uses stubbed node/curl, so it needs
# neither network access nor a deployed backend and runs in a few seconds.
#
#   bash scripts/verify-deployment.test.sh
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT_DIR/scripts/verify-deployment.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

passed=0
failed=0

# ── stubs ─────────────────────────────────────────────────────────────────────
# Behaviour is driven by $STUB_SCENARIO; every RPC probe URL is appended to
# $WORK/probe-calls so tests can assert which endpoint was contacted.
mkdir -p "$WORK/bin"
cat >"$WORK/bin/node" <<STUB
#!/usr/bin/env bash
if [[ "\$1" == "-e" ]]; then
  # Last two args are rpcUrl and timeout; first arg is the script body.
  rpc_url="\${*: -2:1}"
  echo "\$rpc_url" >>"$WORK/probe-calls"
  case "\$STUB_SCENARIO" in
    rpc_ok)       echo ok ;;
    rpc_invalid)  echo invalid ;;
    rpc_error)    echo unreachable ;;
  esac
  exit 0
fi
exec "$(command -v node)" "\$@"
STUB
cat >"$WORK/bin/curl" <<STUB
#!/usr/bin/env bash
url=""
prev=""
for arg in "\$@"; do
  if [[ "\$prev" == "-sf" || "\$prev" == "--max-time" ]]; then prev="\$arg"; continue; fi
  [[ "\$arg" != -* && "\$prev" != "8" ]] && [[ "\$arg" == http* ]] && url="\$arg"
  prev="\$arg"
done
case "\$STUB_SCENARIO" in
  backend_healthy)
    if [[ "\$url" == *"/api/health" ]]; then echo '{"status":"ok","service":"stellar-stream-backend"}'
    elif [[ "\$url" == *"/api/stats" ]]; then echo '{"data":{"onChainStreamCount":0,"localStreamCount":0}}'
    fi
    ;;
  backend_chain_broken)
    if [[ "\$url" == *"/api/health" ]]; then echo '{"status":"ok","service":"stellar-stream-backend"}'
    elif [[ "\$url" == *"/api/stats" ]]; then echo '{"data":{}}'
    fi
    ;;
esac
exit 0
STUB
chmod +x "$WORK/bin/node" "$WORK/bin/curl"

C55="C$(printf 'A%.0s' {1..55})"
S55="S$(printf 'A%.0s' {1..55})"

run_case() {
  # Usage: run_case NAME EXPECTED_EXIT SCENARIO [--script-args...] -- KEY=VALUE...
  # Everything before "--" goes to the script; everything after is env.
  local name="$1" expected="$2" scenario="$3"
  shift 3
  local script_args=() env_vars=()
  local seen_separator=0
  for arg in "$@"; do
    if [[ "$arg" == "--" ]]; then seen_separator=1; continue; fi
    if (( seen_separator == 0 )); then script_args+=("$arg"); else env_vars+=("$arg"); fi
  done
  STUB_SCENARIO="$scenario" \
    env -i "STUB_SCENARIO=$scenario" PATH="$WORK/bin:$PATH" HOME="$HOME" \
    VERIFY_TIMEOUT=2 "${env_vars[@]}" bash "$SCRIPT" "${script_args[@]}" >"$WORK/out" 2>&1
  local actual=$?
  if (( actual != expected )); then
    echo "not ok - $name: expected exit $expected, got $actual"
    sed 's/^/    /' "$WORK/out"
    failed=$(( failed + 1 ))
    return
  fi
  echo "ok - $name"
  passed=$(( passed + 1 ))
}

expect_output() {
  local name="$1" pattern="$2"
  if grep -q "$pattern" "$WORK/out"; then
    echo "ok - $name"
    passed=$(( passed + 1 ))
  else
    echo "not ok - $name: output missing /$pattern/"
    sed 's/^/    /' "$WORK/out"
    failed=$(( failed + 1 ))
  fi
}

expect_absent() {
  local name="$1" pattern="$2"
  if grep -q "$pattern" "$WORK/out"; then
    echo "not ok - $name: output must not contain /$pattern/"
    sed 's/^/    /' "$WORK/out"
    failed=$(( failed + 1 ))
  else
    echo "ok - $name"
    passed=$(( passed + 1 ))
  fi
}

# ── healthy configuration ─────────────────────────────────────────────────────
run_case "healthy testnet config passes offline" 0 rpc_ok --skip-connectivity -- \
  "STELLAR_NETWORK=testnet" "RPC_URL=https://soroban-testnet.stellar.org:443" \
  "CONTRACT_ID=$C55" "SERVER_PRIVATE_KEY=$S55"
expect_output "summary line reports PASS" "RESULT: PASS"
expect_output "per-check PASS lines are printed" "PASS  contract ID"

run_case "mainnet aliases resolve" 0 rpc_ok --skip-connectivity -- \
  "STELLAR_NETWORK=public" "CONTRACT_ID=$C55" "SERVER_PRIVATE_KEY=$S55"
expect_output "public alias resolves to mainnet" "STELLAR_NETWORK resolves to mainnet"

# ── network mismatches fail ───────────────────────────────────────────────────
run_case "mainnet with testnet endpoint fails" 1 rpc_ok --skip-connectivity -- \
  "STELLAR_NETWORK=mainnet" "RPC_URL=https://soroban-testnet.stellar.org:443" \
  "CONTRACT_ID=$C55" "SERVER_PRIVATE_KEY=$S55"
expect_output "mismatch names the offending variables" "STELLAR_NETWORK=mainnet but RPC_URL is the testnet endpoint"

run_case "testnet with mainnet passphrase fails" 1 rpc_ok --skip-connectivity -- \
  "STELLAR_NETWORK=testnet" "NETWORK_PASSPHRASE=Public Global Stellar Network ; September 2015" \
  "CONTRACT_ID=$C55" "SERVER_PRIVATE_KEY=$S55"
expect_output "passphrase mismatch names the variables" "NETWORK_PASSPHRASE is the mainnet passphrase"

run_case "unknown network value fails" 1 rpc_ok --skip-connectivity -- \
  "STELLAR_NETWORK=devnet" "CONTRACT_ID=$C55" "SERVER_PRIVATE_KEY=$S55"
expect_output "unknown network explains allowed values" "must be"

# ── missing / malformed credentials fail ──────────────────────────────────────
run_case "missing CONTRACT_ID fails" 1 rpc_ok --skip-connectivity -- \
  "STELLAR_NETWORK=testnet" "SERVER_PRIVATE_KEY=$S55"
expect_output "missing contract ID names the variable" "CONTRACT_ID is missing"

run_case "malformed CONTRACT_ID fails without printing the value" 1 rpc_ok --skip-connectivity -- \
  "STELLAR_NETWORK=testnet" "CONTRACT_ID=C12345" "SERVER_PRIVATE_KEY=$S55"
expect_output "malformed contract ID explains the shape" "malformed"
expect_absent "malformed contract ID value is not printed" "C12345"

run_case "missing SERVER_PRIVATE_KEY fails" 1 rpc_ok --skip-connectivity -- \
  "STELLAR_NETWORK=testnet" "CONTRACT_ID=$C55"
expect_output "missing server key names the variable" "SERVER_PRIVATE_KEY is missing"

run_case "malformed SERVER_PRIVATE_KEY fails without printing the value" 1 rpc_ok --skip-connectivity -- \
  "STELLAR_NETWORK=testnet" "CONTRACT_ID=$C55" "SERVER_PRIVATE_KEY=not-a-secret"
expect_output "malformed server key explains the shape" "malformed"
expect_absent "malformed server key value is not printed" "not-a-secret"

# ── SOROBAN_DISABLED relaxes chain checks ─────────────────────────────────────
run_case "SOROBAN_DISABLED=true skips chain-credential checks" 0 rpc_ok --skip-connectivity -- \
  "STELLAR_NETWORK=testnet" "SOROBAN_DISABLED=true"
expect_output "disabled mode explains itself" "SOROBAN_DISABLED=true"

# ── live RPC probe ────────────────────────────────────────────────────────────
run_case "reachable RPC passes" 0 rpc_ok -- \
  "STELLAR_NETWORK=testnet" "RPC_URL=https://rpc.example:443" \
  "CONTRACT_ID=$C55" "SERVER_PRIVATE_KEY=$S55"
expect_output "probe outcome is reported" "endpoint answered getLatestLedger"
expect_absent "probe report does not echo the URL" "rpc.example"

run_case "RPC returning junk fails" 1 rpc_invalid -- \
  "STELLAR_NETWORK=testnet" "RPC_URL=https://rpc.example:443" \
  "CONTRACT_ID=$C55" "SERVER_PRIVATE_KEY=$S55"
expect_output "invalid RPC response names credentials" "verify provider credentials"

run_case "unreachable RPC fails" 1 rpc_error -- \
  "STELLAR_NETWORK=testnet" "RPC_URL=https://rpc.example:443" \
  "CONTRACT_ID=$C55" "SERVER_PRIVATE_KEY=$S55"
expect_output "unreachable RPC explains the timeout" "unreachable"

# ── deployed backend checks ───────────────────────────────────────────────────
run_case "healthy deployed backend passes with --backend-url" 0 backend_healthy \
  --backend-url "https://backend.example" --skip-connectivity -- \
  "STELLAR_NETWORK=testnet" "CONTRACT_ID=$C55" "SERVER_PRIVATE_KEY=$S55"
expect_output "backend health check reported" "backend health"
expect_output "backend chain check reported" "chain config"

run_case "deployed backend with broken chain config fails" 1 backend_chain_broken \
  --backend-url "https://backend.example" --skip-connectivity -- \
  "STELLAR_NETWORK=testnet" "CONTRACT_ID=$C55" "SERVER_PRIVATE_KEY=$S55"
expect_output "broken chain config is actionable" "verify CONTRACT_ID"

# ── env-file loading ──────────────────────────────────────────────────────────
cat >"$WORK/backend.env" <<EOF
STELLAR_NETWORK=mainnet
CONTRACT_ID=$C55
SERVER_PRIVATE_KEY=$S55
EOF
STUB_SCENARIO=rpc_ok env -i PATH="$WORK/bin:$PATH" HOME="$HOME" VERIFY_TIMEOUT=2 \
  BACKEND_ENV_FILE="$WORK/backend.env" bash "$SCRIPT" --skip-connectivity >"$WORK/out" 2>&1
actual=$?
if (( actual == 0 )) && grep -q "STELLAR_NETWORK resolves to mainnet" "$WORK/out"; then
  echo "ok - env file values are loaded and used"
  passed=$(( passed + 1 ))
else
  echo "not ok - env file values are loaded and used (exit $actual)"
  sed 's/^/    /' "$WORK/out"
  failed=$(( failed + 1 ))
fi

# ── unknown argument ──────────────────────────────────────────────────────────
run_case "unknown argument exits 1" 1 rpc_ok --frobnicate -- \
  "STELLAR_NETWORK=testnet" "CONTRACT_ID=$C55" "SERVER_PRIVATE_KEY=$S55"

echo
echo "verify-deployment tests: $passed passed, $failed failed"
(( failed == 0 ))
