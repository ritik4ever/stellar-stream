#!/usr/bin/env bash
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
PROJECT="$WORK/project"
mkdir -p "$PROJECT/scripts" "$PROJECT/contracts" "$PROJECT/backend/scripts" "$WORK/bin"
cp "$ROOT_DIR/scripts/deploy.sh" "$PROJECT/scripts/deploy.sh"

REAL_NODE="$(command -v node)"
cat >"$WORK/bin/node" <<'NODE_STUB'
#!/usr/bin/env bash
if [[ "$1" == *"rpc-preflight.cjs" ]]; then
  echo preflight >>"$TEST_WORK/calls"
  if [[ "$RPC_RESULT" == "fail" ]]; then
    echo "RPC connectivity check failed; verify credentials"
    exit 1
  fi
  exit 0
fi
exec "$REAL_NODE" "$@"
NODE_STUB

cat >"$WORK/bin/soroban" <<'SOROBAN_STUB'
#!/usr/bin/env bash
echo "$*" >>"$TEST_WORK/calls"
if [[ "$1 $2" == "contract build" ]]; then
  mkdir -p target/wasm32-unknown-unknown/release
  printf wasm >target/wasm32-unknown-unknown/release/stellar_stream.wasm
  exit 0
fi
if [[ "$1 $2" == "contract deploy" ]]; then
  if [[ "$DEPLOY_RESULT" == "fail" ]]; then
    echo "provider rejected token=cli-output-secret" >&2
    exit 7
  fi
  printf '%056d\n' 0 | tr '0' 'C'
  exit 0
fi
exit 0
SOROBAN_STUB
chmod +x "$WORK/bin/node" "$WORK/bin/soroban"

passed=0
failed=0

run_case() {
  local name="$1" expected="$2" network="$3" rpc_url="$4" rpc_result="$5" deploy_result="$6"
  local secret_key="${7:-S$(printf 'A%.0s' {1..55})}"
  export TEST_WORK="$WORK/$name"
  mkdir -p "$TEST_WORK"
  (
    cd "$PROJECT"
    env PATH="$WORK/bin:$PATH" REAL_NODE="$REAL_NODE" TEST_WORK="$TEST_WORK" \
      SECRET_KEY="$secret_key" STELLAR_NETWORK="$network" \
      RPC_URL="$rpc_url" RPC_RESULT="$rpc_result" DEPLOY_RESULT="$deploy_result" \
      bash scripts/deploy.sh
  ) >"$TEST_WORK/output" 2>&1
  local actual=$?
  if (( actual != expected )); then
    echo "not ok - $name: expected exit $expected, got $actual"
    sed 's/^/    /' "$TEST_WORK/output"
    failed=$(( failed + 1 ))
    return
  fi
  echo "ok - $name"
  passed=$(( passed + 1 ))
}

run_case "malformed secret fails before preflight" 1 testnet "" pass pass invalid-secret-value
if grep -q 'preflight\|contract build\|contract deploy' "$WORK/malformed secret fails before preflight/calls" 2>/dev/null; then
  echo "not ok - malformed secret fails before preflight: deployment work was started"
  failed=$(( failed + 1 ))
fi
if grep -q 'invalid-secret-value' "$WORK/malformed secret fails before preflight/output"; then
  echo "not ok - malformed secret fails before preflight: secret leaked"
  failed=$(( failed + 1 ))
fi

run_case "RPC auth failure stops before build" 1 mainnet \
  "https://rpc.example/stellar?token=provider-secret" fail pass
if grep -q 'contract build\|contract deploy' "$WORK/RPC auth failure stops before build/calls" 2>/dev/null; then
  echo "not ok - RPC auth failure stops before build: Soroban command was called"
  failed=$(( failed + 1 ))
fi
if grep -q 'provider-secret' "$WORK/RPC auth failure stops before build/output"; then
  echo "not ok - RPC auth failure stops before build: URL token leaked"
  failed=$(( failed + 1 ))
fi

run_case "CLI failure suppresses provider output" 1 testnet \
  "https://rpc.example/stellar?token=provider-secret" pass fail
if grep -q 'cli-output-secret\|provider-secret' "$WORK/CLI failure suppresses provider output/output"; then
  echo "not ok - CLI failure suppresses provider output: credential leaked"
  failed=$(( failed + 1 ))
fi
if ! grep -q 'Raw CLI output is suppressed' "$WORK/CLI failure suppresses provider output/output"; then
  echo "not ok - CLI failure suppresses provider output: safe diagnostic missing"
  failed=$(( failed + 1 ))
fi

run_case "successful deployment saves contract ID" 0 testnet "" pass pass
if [[ ! -f "$PROJECT/contracts/contract_id.txt" || $(wc -c <"$PROJECT/contracts/contract_id.txt") -ne 57 ]]; then
  echo "not ok - successful deployment saves contract ID: output file missing or malformed"
  failed=$(( failed + 1 ))
fi

echo
echo "deploy tests: $passed passed, $failed failed"
(( failed == 0 ))