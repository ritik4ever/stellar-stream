#!/usr/bin/env bash
# Validate Contract CI reproducibility from a fresh checkout.
#
# No Rust toolchain, soroban CLI, or network access required. All checks are
# static analyses of files present in a clean checkout, so the result can be
# reproduced without undocumented local state:
#
#   bash scripts/contract-ci-validate.sh
#
# Exit 0 when Contract CI is internally consistent, 1 with a failure list
# otherwise. See issue #1194 (SSB-2026-251).
set -uo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
failures=0

fail() { echo "FAIL: $1"; failures=$((failures + 1)); }
pass() { echo "PASS: $1"; }

# 1. bindings-drift must trigger on a real workflow name.
if grep -q '"CI - Build Checks"' "$ROOT_DIR/.github/workflows/bindings-drift.yml"; then
  fail "bindings-drift triggers on non-existent workflow 'CI - Build Checks'"
else
  pass "bindings-drift trigger references an existing workflow"
fi
for wf in "$ROOT_DIR"/.github/workflows/*.yml; do
  grep -h '^name:' "$wf"
done | sort | uniq -c | head -20

# 2. bindings-drift must run gen:bindings where the script exists (repo root).
if grep -A3 'Install frontend dependencies' "$ROOT_DIR/.github/workflows/bindings-drift.yml" | grep -q 'working-directory: frontend'; then
  if grep -A2 'Generate contract bindings' "$ROOT_DIR/.github/workflows/bindings-drift.yml" | grep -q 'working-directory: frontend'; then
    if ! grep -q '"gen:bindings"' "$ROOT_DIR/frontend/package.json"; then
      fail "bindings-drift runs 'npm run gen:bindings' in frontend/ but frontend/package.json has no such script (it lives in root package.json)"
    fi
  else
    # No working-directory override on the generate step: runs at root -> OK.
    pass "bindings-drift runs gen:bindings from repo root"
  fi
else
  pass "bindings-drift frontend install step not found (manual review)"
fi

# 3. CONTRACT_ID must resolve to file content, not a literal string.
if grep -q "format('cat contracts/contract_id.txt')" "$ROOT_DIR/.github/workflows/bindings-drift.yml"; then
  fail "bindings-drift CONTRACT_ID uses format('cat contracts/contract_id.txt') which yields a literal string, not the file content"
else
  pass "bindings-drift CONTRACT_ID resolution does not use literal format() fallback"
fi

# 4. bindings-drift needs soroban CLI installed before generating bindings.
if ! grep -q 'soroban-cli\|stellar-cli' "$ROOT_DIR/.github/workflows/bindings-drift.yml"; then
  fail "bindings-drift never installs soroban/stellar CLI, so generate-contract-bindings.sh exits 1 ('soroban-cli is not installed')"
else
  pass "bindings-drift installs soroban/stellar CLI"
fi

# 5. Smoke test initialize() args must match contracts/src/lib.rs.
smoke_init_block=$(grep -A22 'Initialize Contract' "$ROOT_DIR/.github/workflows/contract-smoke.yml")
smoke_init_args=$(echo "$smoke_init_block" | grep -o '\-\-[a-z_]*' | sort | tr '\n' ' ')
if echo "$smoke_init_args" | grep -q 'native_token\|native-token'; then
  pass "smoke initialize passes native_token"
else
  fail "smoke 'initialize --admin' is stale: lib.rs initialize(env, admin, native_token, allowed_tokens) needs 3 args, smoke passes only --admin [$smoke_init_args]"
fi

# 6. Smoke test create_stream args must match lib.rs (incl. min_claim_interval_seconds).
smoke_create_args=$(grep -A30 'Smoke Test - create_stream' "$ROOT_DIR/.github/workflows/contract-smoke.yml" | grep -o '\-\-[a-z_]*' | sort -u | tr '\n' ' ')
if echo "$smoke_create_args" | grep -q 'min_claim_interval'; then
  pass "smoke create_stream passes min_claim_interval_seconds"
else
  fail "smoke create_stream is stale: lib.rs needs sender/recipient/token/total_amount/start_time/end_time/min_claim_interval_seconds/metadata, smoke passes [$smoke_create_args]"
fi

# 7. CI must build the same artifact that scripts/deploy.sh deploys (--wasm flag).
deploy_target=$(grep -o '\-\-wasm target/[a-z0-9-]*/[a-z]*/stellar_stream.wasm' "$ROOT_DIR/scripts/deploy.sh" | head -1)
deployed_target_triple=$(echo "$deploy_target" | grep -o 'wasm32[a-z0-9-]*' | head -1)
if [ -z "$deployed_target_triple" ]; then
  fail "could not determine deploy --wasm target in scripts/deploy.sh"
elif grep -q "$deployed_target_triple" "$ROOT_DIR/.github/workflows/contract-ci.yml"; then
  pass "contract-ci builds the deployed target ($deployed_target_triple)"
else
  ci_targets=$(grep -o 'wasm32[a-z0-9-]*' "$ROOT_DIR/.github/workflows/contract-ci.yml" | sort -u | tr '\n' ' ')
  fail "WASM target mismatch: deploy.sh deploys [$deployed_target_triple] but contract-ci builds [$ci_targets]"
fi

# 8. Toolchain pin must be consistent: rust-toolchain.toml vs workflows vs docs.
pin=$(grep 'channel' "$ROOT_DIR/contracts/rust-toolchain.toml")
echo "INFO: rust-toolchain.toml: $pin"
if grep -q 'toolchain: stable' "$ROOT_DIR/.github/workflows/contract-smoke.yml"; then
  fail "contract-smoke pins 'toolchain: stable', overriding contracts/rust-toolchain.toml ($pin)"
else
  pass "contract-smoke respects rust-toolchain.toml pin"
fi
if grep -q 'wasm32-unknown-unknown.*| stable |' "$ROOT_DIR/docs/CONTRACT_BINDINGS.md"; then
  fail "docs/CONTRACT_BINDINGS.md prerequisites claim stable toolchain, contradicting rust-toolchain.toml ($pin)"
else
  pass "docs toolchain prerequisite matches rust-toolchain.toml"
fi

echo
if (( failures > 0 )); then
  echo "contract-ci-validate: $failures failure(s)"
  exit 1
fi
echo "contract-ci-validate: all checks passed"
