#!/usr/bin/env bash
# ──────────────────────────────────────────────────────────────────────────────
# verify-deployment.sh — repeatable deployment-configuration smoke test.
#
# Verifies, with a clear per-check PASS/FAIL and one overall pass/fail exit
# code, that a deployment's configuration is internally consistent before (or
# after) it serves traffic:
#
#   1. STELLAR_NETWORK selects a known network (testnet default, mainnet aliases).
#   2. RPC_URL / NETWORK_PASSPHRASE belong to the selected network.
#   3. CONTRACT_ID is present and shaped like a Soroban contract ID (C + 55).
#   4. SERVER_PRIVATE_KEY is present and shaped like a Stellar secret (S + 55).
#   5. (default) The selected RPC endpoint answers a getLatestLedger probe.
#   6. (with --backend-url) The deployed backend reports a healthy network.
#
# Exit codes: 0 all checks passed, 1 at least one check failed.
#
# Usage:
#   bash scripts/verify-deployment.sh                          # env/`.env` based
#   BACKEND_ENV_FILE=backend/.env bash scripts/verify-deployment.sh
#   bash scripts/verify-deployment.sh --skip-connectivity      # offline config check
#   bash scripts/verify-deployment.sh --backend-url https://…  # + deployed checks
#
# The script never prints a secret value: checks validate shape and presence
# only, and network/probe diagnostics name variables, not values. It runs in
# well under 30 seconds so it is cheap to run before and after every deploy.
#
# Tunables (environment variables):
#   BACKEND_ENV_FILE    backend env file to load (default backend/.env if present)
#   VERIFY_TIMEOUT      seconds for the RPC probe (default 10)
# ──────────────────────────────────────────────────────────────────────────────
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
ENV_FILE="${BACKEND_ENV_FILE:-}"
SKIP_CONNECTIVITY=0
BACKEND_URL=""

while (( $# > 0 )); do
  case "$1" in
    --skip-connectivity) SKIP_CONNECTIVITY=1; shift ;;
    --backend-url)       BACKEND_URL="${2:-}"; shift 2 ;;
    -h|--help)
      sed -n '2,30p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      printf '[verify-deployment] FAIL: unknown argument %s\n' "$1" >&2
      exit 1
      ;;
  esac
done

# ── load environment ─────────────────────────────────────────────────────────
if [[ -z "$ENV_FILE" && -f "$ROOT_DIR/backend/.env" ]]; then
  ENV_FILE="$ROOT_DIR/backend/.env"
fi
if [[ -n "$ENV_FILE" ]]; then
  if [[ ! -f "$ENV_FILE" ]]; then
    printf '[verify-deployment] FAIL: env file not found: %s\n' "$ENV_FILE" >&2
    exit 1
  fi
  # shellcheck disable=SC1090
  while IFS='=' read -r key value; do
    key="${key%%[[:space:]]*}"
    [[ -z "$key" || "$key" == \#* ]] && continue
    if [[ -z "${!key:-}" ]]; then
      value="${value%\"}"; value="${value#\"}"
      value="${value%\'}"; value="${value#\'}"
      export "$key=$value"
    fi
  done <"$ENV_FILE"
fi

NETWORK_PROFILES_TESTNET_RPC='https://soroban-testnet.stellar.org:443'
NETWORK_PROFILES_MAINNET_RPC='https://soroban-rpc.stellar.org:443'
TESTNET_PASSPHRASE='Test SDF Network ; September 2015'
MAINNET_PASSPHRASE='Public Global Stellar Network ; September 2015'

passed=0
failed=0
overall=pass

record() {
  local status="$1" name="$2" detail="${3:-}"
  if [[ "$status" == PASS || "$status" == SKIP ]]; then
    printf '%s  %s%s\n' "$status" "$name" "${detail:+ — $detail}"
    passed=$(( passed + 1 ))
  else
    printf 'FAIL  %s%s\n' "$name" "${detail:+ — $detail}"
    failed=$(( failed + 1 ))
    overall=fail
  fi
}

# ══════════════════════════════════════════════════════════════════════════════
# Check 1: network selection
# ══════════════════════════════════════════════════════════════════════════════
raw_network="${STELLAR_NETWORK:-}"
network=""
case "${raw_network,,}" in
  ''|testnet|test)  network=testnet ;;
  mainnet|public|main) network=mainnet ;;
  *)
    record FAIL "network selection" \
      "STELLAR_NETWORK must be \"testnet\" or \"mainnet\" (aliases: public, main); got an unrecognized value"
    ;;
esac
# A passphrase dropped into STELLAR_NETWORK is the documented legacy fallback.
if [[ -z "$network" ]]; then
  if [[ "$raw_network" == "$TESTNET_PASSPHRASE" ]]; then
    network=testnet
  elif [[ "$raw_network" == "$MAINNET_PASSPHRASE" ]]; then
    network=mainnet
  fi
fi
if [[ -n "$network" ]]; then
  if [[ -n "$raw_network" ]]; then
    record PASS "network selection" "STELLAR_NETWORK resolves to $network"
  else
    record PASS "network selection" "STELLAR_NETWORK unset — defaults to testnet"
  fi
fi

# ══════════════════════════════════════════════════════════════════════════════
# Check 2: RPC endpoint and passphrase belong to the selected network
# ══════════════════════════════════════════════════════════════════════════════
rpc_url="${SOROBAN_RPC_URL:-${RPC_URL:-}}"
passphrase="${NETWORK_PASSPHRASE:-}"

rpc_status=PASS
rpc_detail=""
if [[ -z "$rpc_url" ]]; then
  rpc_detail="RPC_URL unset — defaults to the $network endpoint"
elif [[ "$rpc_url" == "$NETWORK_PROFILES_TESTNET_RPC" ]]; then
  if [[ "$network" == mainnet ]]; then
    rpc_status=FAIL; rpc_detail="STELLAR_NETWORK=mainnet but RPC_URL is the testnet endpoint"
  else
    rpc_detail="RPC_URL is the well-known $network endpoint"
  fi
elif [[ "$rpc_url" == "$NETWORK_PROFILES_MAINNET_RPC" ]]; then
  if [[ "$network" == testnet ]]; then
    rpc_status=FAIL; rpc_detail="STELLAR_NETWORK=testnet but RPC_URL is the mainnet endpoint"
  else
    rpc_detail="RPC_URL is the well-known $network endpoint"
  fi
else
  # Custom endpoint: classify the host, tolerating provider tokens that merely
  # contain the words "testnet"/"mainnet".
  if [[ "$rpc_url" =~ ^https?://[^/]*testnet ]] && [[ "$network" == mainnet ]]; then
    rpc_status=FAIL; rpc_detail="STELLAR_NETWORK=mainnet but RPC_URL host looks like a testnet endpoint"
  elif [[ "$rpc_url" =~ ^https?://[^/]*mainnet ]] && [[ "$network" == testnet ]]; then
    rpc_status=FAIL; rpc_detail="STELLAR_NETWORK=testnet but RPC_URL host looks like a mainnet endpoint"
  else
    rpc_detail="custom RPC endpoint (host not classified)"
  fi
fi
record "$rpc_status" "RPC endpoint matches network" "$rpc_detail"

pass_status=PASS
pass_detail=""
if [[ -z "$passphrase" ]]; then
  pass_detail="NETWORK_PASSPHRASE unset — defaults to the $network passphrase"
elif [[ "$passphrase" == "$MAINNET_PASSPHRASE" && "$network" == testnet ]]; then
  pass_status=FAIL; pass_detail="STELLAR_NETWORK=testnet but NETWORK_PASSPHRASE is the mainnet passphrase"
elif [[ "$passphrase" == "$TESTNET_PASSPHRASE" && "$network" == mainnet ]]; then
  pass_status=FAIL; pass_detail="STELLAR_NETWORK=mainnet but NETWORK_PASSPHRASE is the testnet passphrase"
else
  pass_detail="NETWORK_PASSPHRASE consistent with $network"
fi
record "$pass_status" "network passphrase matches network" "$pass_detail"

# ══════════════════════════════════════════════════════════════════════════════
# Check 3: contract ID present and well-formed
# ══════════════════════════════════════════════════════════════════════════════
contract_id="${STELLAR_CONTRACT_ID:-${CONTRACT_ID:-}}"
soroban_disabled="${SOROBAN_DISABLED:-}"
if [[ "${soroban_disabled,,}" == true ]]; then
  record SKIP "contract ID" "SOROBAN_DISABLED=true — chain features intentionally off (never for production)"
  record SKIP "server signing key" "SOROBAN_DISABLED=true — chain features intentionally off"
else
  if [[ -z "$contract_id" ]]; then
    record FAIL "contract ID" "CONTRACT_ID is missing — set it from contracts/contract_id.txt of the deploy run"
  elif [[ ! "$contract_id" =~ ^C[A-Za-z0-9]{55}$ ]]; then
    record FAIL "contract ID" "CONTRACT_ID is present but malformed (expected 56 characters starting with C) — value not printed"
  else
    record PASS "contract ID" "present and well-formed (value not printed)"
  fi

  # ════════════════════════════════════════════════════════════════════════════
  # Check 4: server private key present and well-formed
  # ════════════════════════════════════════════════════════════════════════════
  server_key="${SERVER_PRIVATE_KEY:-}"
  if [[ -z "$server_key" ]]; then
    record FAIL "server signing key" "SERVER_PRIVATE_KEY is missing — required for on-chain operations"
  elif [[ ! "$server_key" =~ ^S[A-Za-z0-9]{55}$ ]]; then
    record FAIL "server signing key" "SERVER_PRIVATE_KEY is present but malformed (expected 56 characters starting with S) — value not printed"
  else
    record PASS "server signing key" "present and well-formed (value not printed)"
  fi
fi

# ══════════════════════════════════════════════════════════════════════════════
# Check 5 (default): the selected RPC endpoint answers a getLatestLedger probe
# ══════════════════════════════════════════════════════════════════════════════
if (( SKIP_CONNECTIVITY == 0 )) && [[ -n "$rpc_url" ]]; then
  timeout_seconds="${VERIFY_TIMEOUT:-10}"
  probe_result="$(node -e '
    const [rpcUrl, timeoutSeconds] = process.argv.slice(1);
    fetch(rpcUrl, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getLatestLedger" }),
      signal: AbortSignal.timeout(Number(timeoutSeconds) * 1000),
    })
      .then((r) => r.json().then(
        (payload) => {
          // getLatestLedger returns the ledger fields at the top of `result`
          // (result.sequence) — match both that shape and the nested
          // result.latestLedger.sequence shape for provider compatibility.
          const sequence =
            payload?.result?.latestLedger?.sequence ?? payload?.result?.sequence;
          if (payload?.error || !Number.isInteger(sequence)) {
            console.log("invalid");
          } else {
            console.log("ok");
          }
        },
        () => console.log("invalid"),
      ))
      .catch(() => console.log("unreachable"));
  ' "$rpc_url" "$timeout_seconds" 2>/dev/null || echo unreachable)"
  case "$probe_result" in
    ok)          record PASS "RPC connectivity" "endpoint answered getLatestLedger (URL and credentials not printed)" ;;
    invalid)     record FAIL "RPC connectivity" "endpoint replied but not with a latest-ledger result — verify provider credentials" ;;
    *)           record FAIL "RPC connectivity" "endpoint unreachable after ${timeout_seconds}s — verify RPC_URL and network egress" ;;
  esac
elif (( SKIP_CONNECTIVITY == 1 )); then
  record SKIP "RPC connectivity" "skipped (--skip-connectivity)"
fi

# ══════════════════════════════════════════════════════════════════════════════
# Check 6 (optional): the deployed backend agrees with this configuration
# ══════════════════════════════════════════════════════════════════════════════
if [[ -n "$BACKEND_URL" ]]; then
  health_json="$(curl -sf --max-time "${VERIFY_TIMEOUT:-10}" "$BACKEND_URL/api/health" 2>/dev/null || true)"
  if [[ "$health_json" == *'"status":"ok"'* ]]; then
    record PASS "deployed backend health" "$BACKEND_URL/api/health reports ok"
  else
    record FAIL "deployed backend health" "$BACKEND_URL/api/health did not report ok — service may still be starting"
  fi

  stats_json="$(curl -sf --max-time "${VERIFY_TIMEOUT:-10}" "$BACKEND_URL/api/stats" 2>/dev/null || true)"
  if [[ "$stats_json" == *'onChainStreamCount'* ]]; then
    record PASS "deployed backend chain config" "/api/stats returns onChainStreamCount — CONTRACT_ID and RPC answer queries"
  else
    record FAIL "deployed backend chain config" "/api/stats did not return onChainStreamCount — verify CONTRACT_ID and RPC_URL on the deployment"
  fi
fi

# ── summary ──────────────────────────────────────────────────────────────────
printf '\n[verify-deployment] RESULT: %s (%d passed, %d failed)\n' \
  "$( [[ "$overall" == pass ]] && echo PASS || echo FAIL )" "$passed" "$failed"
[[ "$overall" == pass ]]
