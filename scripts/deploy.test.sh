#!/usr/bin/env bash
# Tests for scripts/deploy.sh network selection and preflight (issue #1204).
#
# Uses a stub `soroban` binary, so it needs neither the Soroban CLI, network
# access, nor a funded account, and runs in a few seconds from a fresh
# checkout. Every case runs in an empty environment (`env -i`) with its own
# working directory, so no local .env, no contracts/contract_id.txt and no
# cached deploy output can influence the result — the documented behaviour is
# reproducible from the repo as committed.
#
#   bash scripts/deploy.test.sh
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SCRIPT="$ROOT_DIR/scripts/deploy.sh"
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT

passed=0
failed=0

# Exactly 56 characters (the format deploy.sh validates): prefix + 'A' padding.
TESTNET_ID="C$(printf 'A%.0s' $(seq 1 55))"
MAINNET_ID="CB$(printf 'A%.0s' $(seq 1 54))"

# ── stub soroban ──────────────────────────────────────────────────────────────
# Behaviour is driven by $STUB_SCENARIO; every call is appended to $STUB_DIR/calls.
mkdir -p "$WORK/bin"
cat >"$WORK/bin/soroban" <<'STUB'
#!/usr/bin/env bash
echo "soroban $*" >>"$STUB_DIR/calls"

if [[ "$1 $2" == "contract build" ]]; then
  if [[ "$STUB_SCENARIO" == "build_fails" ]]; then
    echo "error: build failed" >&2
    exit 1
  fi
  mkdir -p target/wasm32-unknown-unknown/release
  echo "fake wasm" > target/wasm32-unknown-unknown/release/stellar_stream.wasm
  exit 0
fi

if [[ "$1 $2" == "contract deploy" ]]; then
  echo "$*" >>"$STUB_DIR/deploy-args"
  case "$STUB_SCENARIO" in
    success)   echo "$STUB_EXPECTED_ID" ;;
    short_id)  echo "C12345" ;;
    garbage)   echo "deployed" ;;
    deploy_fails) echo "error: insufficient funds" >&2; exit 1 ;;
    *) echo "unexpected scenario" >&2; exit 1 ;;
  esac
  exit 0
fi

exit 1
STUB
chmod +x "$WORK/bin/soroban"

# run_case <name> <scenario> <expected exit> [VAR=value ...]
# Runs the real deploy.sh with cwd=$STUB_DIR, so the script's relative
# `contracts/` directory (build output, contract_id.txt) stays inside the case
# sandbox and never touches the repository checkout.
run_case() {
  local name="$1" scenario="$2" expected="$3"
  shift 3
  export STUB_DIR="$WORK/$name"
  mkdir -p "$STUB_DIR/contracts"
  if [[ "$scenario" == success ]]; then
    export STUB_EXPECTED_ID="$TESTNET_ID"
    [[ "${STELLAR_NETWORK:-}" == "mainnet" ]] && STUB_EXPECTED_ID="$MAINNET_ID"
  fi
  # cwd is the case sandbox: the script's relative `contracts/` directory
  # (build output, contract_id.txt) must never touch the repository checkout.
  ( cd "$STUB_DIR" && \
    STUB_SCENARIO="$scenario" \
    STUB_EXPECTED_ID="${STUB_EXPECTED_ID:-$TESTNET_ID}" \
      env -i PATH="$WORK/bin:/usr/bin:/bin" \
        STUB_DIR="$STUB_DIR" STUB_SCENARIO="$scenario" STUB_EXPECTED_ID="${STUB_EXPECTED_ID:-$TESTNET_ID}" \
        "$@" \
      bash "$SCRIPT" >"$STUB_DIR/out" 2>&1
  )
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

# ── success paths: network selection reaches the CLI ─────────────────────────
name="default deployment targets testnet with testnet defaults"
if run_case default_testnet success 0 SECRET_KEY="SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" &&
   check "$name" "deployed on testnet" grep -q -- "--network testnet" "$CASE_DIR/deploy-args" &&
   check "$name" "testnet RPC default" grep -q -- "--rpc-url https://soroban-testnet.stellar.org:443" "$CASE_DIR/deploy-args" &&
   check "$name" "testnet passphrase default" grep -q -- "--network-passphrase Test SDF Network ; September 2015" "$CASE_DIR/deploy-args" &&
   check "$name" "contract ID saved in the case sandbox" bash -c "[[ \"\$(cat '$CASE_DIR/contracts/contract_id.txt')\" == '$TESTNET_ID' ]]" &&
   check "$name" "network echoed" grep -q "Network: testnet" "$CASE_DIR/out"; then
  pass_case "$name"
fi

name="STELLAR_NETWORK=mainnet targets mainnet with mainnet defaults"
if run_case explicit_mainnet success 0 SECRET_KEY="SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" STELLAR_NETWORK=mainnet &&
   check "$name" "deployed on mainnet" grep -q -- "--network mainnet" "$CASE_DIR/deploy-args" &&
   check "$name" "mainnet RPC default" grep -q -- "--rpc-url https://soroban-rpc.stellar.org:443" "$CASE_DIR/deploy-args" &&
   check "$name" "mainnet passphrase default" grep -q -- "--network-passphrase Public Global Stellar Network ; September 2015" "$CASE_DIR/deploy-args" &&
   check "$name" "network echoed" grep -q "Network: mainnet" "$CASE_DIR/out"; then
  pass_case "$name"
fi

name="STELLAR_NETWORK=public alias behaves like mainnet"
if run_case alias_public success 0 SECRET_KEY="SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" STELLAR_NETWORK=public &&
   check "$name" "deployed on mainnet" grep -q -- "--network mainnet" "$CASE_DIR/deploy-args"; then
  pass_case "$name"
fi

name="explicit RPC_URL and passphrase override the network defaults"
if run_case custom_endpoints success 0 SECRET_KEY="SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" \
     STELLAR_NETWORK=mainnet RPC_URL="https://rpc.provider.example:443" NETWORK_PASSPHRASE="Custom Standalone ; Network" &&
   check "$name" "custom RPC used" grep -q -- "--rpc-url https://rpc.provider.example:443" "$CASE_DIR/deploy-args" &&
   check "$name" "custom passphrase used" grep -q -- "--network-passphrase Custom Standalone ; Network" "$CASE_DIR/deploy-args" &&
   check "$name" "still deployed on mainnet" grep -q -- "--network mainnet" "$CASE_DIR/deploy-args"; then
  pass_case "$name"
fi

# ── preflight failures: exit before building or deploying ────────────────────
# Every case below must exit 1 with no `contract build`/`contract deploy` call
# and no contract_id.txt written, so a failed run leaves nothing behind.

name="missing SECRET_KEY exits before building"
if run_case no_secret success 1 &&
   check "$name" "SECRET_KEY error reported" grep -q "SECRET_KEY environment variable is required" "$CASE_DIR/out" &&
   check "$name" "no build attempted" bash -c "! grep -q 'contract build' '$CASE_DIR/calls'"; then
  pass_case "$name"
fi

name="unknown STELLAR_NETWORK exits before building"
if run_case unknown_network success 1 SECRET_KEY="SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" STELLAR_NETWORK=stagenet &&
   check "$name" "network error reported" grep -q 'unknown STELLAR_NETWORK stagenet' "$CASE_DIR/out" &&
   check "$name" "no build attempted" bash -c "! grep -q 'contract build' '$CASE_DIR/calls'"; then
  pass_case "$name"
fi

name="mainnet selection with testnet RPC_URL exits before building"
if run_case mainnet_testnet_rpc success 1 SECRET_KEY="SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" \
     STELLAR_NETWORK=mainnet RPC_URL="https://soroban-testnet.stellar.org:443" &&
   check "$name" "mismatch reported" grep -q "RPC_URL points at a testnet endpoint" "$CASE_DIR/out" &&
   check "$name" "no build attempted" bash -c "! grep -q 'contract build' '$CASE_DIR/calls'"; then
  pass_case "$name"
fi

name="testnet selection with mainnet RPC_URL exits before building"
if run_case testnet_mainnet_rpc success 1 SECRET_KEY="SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" \
     RPC_URL="https://soroban-rpc.stellar.org:443" &&
   check "$name" "mismatch reported" grep -q "RPC_URL points at a mainnet endpoint" "$CASE_DIR/out" &&
   check "$name" "no deploy attempted" bash -c "! test -f '$CASE_DIR/deploy-args'"; then
  pass_case "$name"
fi

name="mainnet passphrase with testnet selection exits before building"
if run_case passphrase_mainnet success 1 SECRET_KEY="SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" \
     NETWORK_PASSPHRASE="Public Global Stellar Network ; September 2015" &&
   check "$name" "mismatch reported" grep -q "NETWORK_PASSPHRASE is the mainnet passphrase" "$CASE_DIR/out" &&
   check "$name" "no build attempted" bash -c "! grep -q 'contract build' '$CASE_DIR/calls'"; then
  pass_case "$name"
fi

name="testnet passphrase with mainnet selection exits before building"
if run_case passphrase_testnet success 1 SECRET_KEY="SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" \
     STELLAR_NETWORK=mainnet RPC_URL="https://rpc.provider.example:443" \
     NETWORK_PASSPHRASE="Test SDF Network ; September 2015" &&
   check "$name" "mismatch reported" grep -q "NETWORK_PASSPHRASE is the testnet passphrase" "$CASE_DIR/out" &&
   check "$name" "no build attempted" bash -c "! grep -q 'contract build' '$CASE_DIR/calls'"; then
  pass_case "$name"
fi

name="missing soroban-cli exits before building"
# Run from the case sandbox without the stub directory on PATH, so `soroban`
# cannot be found and the CLI check must fire before any build.
CASE_DIR="$WORK/no_cli"
mkdir -p "$CASE_DIR/contracts"
if ( cd "$CASE_DIR" && env -i PATH="/usr/bin:/bin" \
      SECRET_KEY="SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" \
      bash "$SCRIPT" >"$CASE_DIR/out" 2>&1 ); then
  fail_case "$name" "expected non-zero exit when the CLI is missing"
else
  if grep -q "soroban-cli is not installed" "$CASE_DIR/out" &&
     ! grep -q "Contract built successfully" "$CASE_DIR/out"; then
    pass_case "$name"
  else
    fail_case "$name" "expected CLI-missing error without a build"
  fi
fi

name="contract build failure exits with the error and deploys nothing"
if run_case build_fails build_fails 1 SECRET_KEY="SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" &&
   check "$name" "build error reported" grep -q "Contract build failed" "$CASE_DIR/out" &&
   check "$name" "no deploy attempted" bash -c "! test -f '$CASE_DIR/deploy-args'"; then
  pass_case "$name"
fi

# ── deploy output handling ────────────────────────────────────────────────────

name="deploy failure is reported and writes no contract ID"
if run_case deploy_fails deploy_fails 1 SECRET_KEY="SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" &&
   check "$name" "deploy error reported" grep -q "Contract deployment failed" "$CASE_DIR/out" &&
   check "$name" "provider error shown" grep -q "insufficient funds" "$CASE_DIR/out" &&
   check "$name" "no contract ID file" bash -c "! test -f '$CASE_DIR/contracts/contract_id.txt'"; then
  pass_case "$name"
fi

name="too-short contract ID output exits without writing the file"
if run_case short_id short_id 1 SECRET_KEY="SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" &&
   check "$name" "format error reported" grep -q "Invalid contract ID format" "$CASE_DIR/out" &&
   check "$name" "no contract ID file" bash -c "! test -f '$CASE_DIR/contracts/contract_id.txt'"; then
  pass_case "$name"
fi

name="output without a contract ID exits without writing the file"
if run_case garbage garbage 1 SECRET_KEY="SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA" &&
   check "$name" "format error reported" grep -q "Invalid contract ID format" "$CASE_DIR/out" &&
   check "$name" "no contract ID file" bash -c "! test -f '$CASE_DIR/contracts/contract_id.txt'"; then
  pass_case "$name"
fi

echo
echo "deploy tests: $passed passed, $failed failed"
(( failed == 0 ))
