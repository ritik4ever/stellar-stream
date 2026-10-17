#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
GENERATOR="$SCRIPT_DIR/generate-contract-bindings.sh"
TEMP_ROOT="$(mktemp -d)"
trap 'rm -rf "$TEMP_ROOT"' EXIT

BIN_DIR="$TEMP_ROOT/bin"
OUTPUT_DIR="$TEMP_ROOT/generated"
mkdir -p "$BIN_DIR" "$OUTPUT_DIR"
printf 'previous bindings\n' > "$OUTPUT_DIR/previous.ts"

cat > "$BIN_DIR/soroban" <<'STUB'
#!/usr/bin/env bash
set -euo pipefail

if [[ "${FAKE_SOROBAN_MODE:-success}" == "failure" ]]; then
    echo "simulated failure containing SECRET_SENTINEL" >&2
    exit 1
fi

output_dir=""
while (($#)); do
    if [[ "$1" == "--output-dir" ]]; then
        output_dir="$2"
        shift 2
    else
        shift
    fi
done

mkdir -p "$output_dir"
printf 'generated bindings\n' > "$output_dir/index.ts"
STUB
chmod +x "$BIN_DIR/soroban"

valid_contract_id="C$(printf '%55s' '' | tr ' ' 'A')"
secret_rpc_url="https://rpc.example/?token=SECRET_SENTINEL"

if CONTRACT_ID="invalid SECRET_SENTINEL" \
    RPC_URL="$secret_rpc_url" \
    BINDINGS_OUTPUT_DIR="$OUTPUT_DIR" \
    PATH="$BIN_DIR:$PATH" \
    bash "$GENERATOR" > "$TEMP_ROOT/invalid.log" 2>&1; then
    echo "Expected an invalid contract ID to fail." >&2
    exit 1
fi
grep -q 'previous bindings' "$OUTPUT_DIR/previous.ts"
if grep -q 'SECRET_SENTINEL' "$TEMP_ROOT/invalid.log"; then
    echo "Invalid-input output exposed a secret sentinel." >&2
    exit 1
fi

if CONTRACT_ID="$valid_contract_id" \
    RPC_URL="$secret_rpc_url" \
    BINDINGS_OUTPUT_DIR="$OUTPUT_DIR" \
    FAKE_SOROBAN_MODE=failure \
    PATH="$BIN_DIR:$PATH" \
    bash "$GENERATOR" > "$TEMP_ROOT/failure.log" 2>&1; then
    echo "Expected a simulated Soroban failure to fail." >&2
    exit 1
fi
grep -q 'previous bindings' "$OUTPUT_DIR/previous.ts"
if grep -q 'SECRET_SENTINEL' "$TEMP_ROOT/failure.log"; then
    echo "Generation-failure output exposed a secret sentinel." >&2
    exit 1
fi

CONTRACT_ID="$valid_contract_id" \
    RPC_URL="$secret_rpc_url" \
    BINDINGS_OUTPUT_DIR="$OUTPUT_DIR" \
    PATH="$BIN_DIR:$PATH" \
    bash "$GENERATOR" > "$TEMP_ROOT/success.log" 2>&1

test -s "$OUTPUT_DIR/index.ts"
test ! -e "$OUTPUT_DIR/previous.ts"
if grep -q 'SECRET_SENTINEL' "$TEMP_ROOT/success.log"; then
    echo "Successful generation output exposed a secret sentinel." >&2
    exit 1
fi

echo "Binding generator validation and rollback tests passed."