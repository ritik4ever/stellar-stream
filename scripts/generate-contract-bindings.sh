#!/bin/bash

# Generate TypeScript contract bindings for StellarStream frontend
#
# This script wraps `soroban contract bindings typescript` and outputs
# the generated client to frontend/src/contracts/generated/.
#
# Required environment variables:
#   CONTRACT_ID - Deployed Soroban contract ID (56 chars, starts with C)
#
# Optional environment variables:
#   NETWORK_PASSPHRASE - Network passphrase (defaults to testnet)
#   RPC_URL            - RPC endpoint URL (defaults to testnet)
#
# Usage:
#   CONTRACT_ID="C..." npm run gen:bindings
#   CONTRACT_ID="C..." ./scripts/generate-contract-bindings.sh

set -euo pipefail

# ── Colors ────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# ── Config ────────────────────────────────────────────────────────────────
OUTPUT_DIR="${BINDINGS_OUTPUT_DIR:-frontend/src/contracts/generated}"
CONTRACT_ID_VALUE="${CONTRACT_ID:-}"
NETWORK_PASSPHRASE="${NETWORK_PASSPHRASE:-Test SDF Network ; September 2015}"
RPC_URL="${RPC_URL:-https://soroban-testnet.stellar.org:443}"

# ── Checks ────────────────────────────────────────────────────────────────
if [[ ! "$CONTRACT_ID_VALUE" =~ ^C[A-Z2-7]{55}$ ]]; then
    echo -e "${RED}Error: CONTRACT_ID is missing or invalid${NC}"
    echo "Set it to a Stellar contract ID (C followed by 55 base32 characters)."
    exit 1
fi

if [[ -z "$NETWORK_PASSPHRASE" ]]; then
    echo -e "${RED}Error: NETWORK_PASSPHRASE must not be empty${NC}"
    exit 1
fi

if [[ ! "$RPC_URL" =~ ^https?://[^[:space:]]+$ ]]; then
    echo -e "${RED}Error: RPC_URL must be a valid HTTP(S) URL${NC}"
    exit 1
fi

if ! command -v soroban >/dev/null 2>&1; then
    echo -e "${RED}Error: soroban-cli is not installed${NC}"
    echo "Install it from: https://soroban.stellar.org/docs/getting-started/setup#install-the-soroban-cli"
    exit 1
fi

# ── Run ───────────────────────────────────────────────────────────────────
echo -e "${GREEN}Generating TypeScript bindings...${NC}"
echo "Output      : $OUTPUT_DIR"
echo ""

OUTPUT_PARENT="$(dirname "$OUTPUT_DIR")"
OUTPUT_NAME="$(basename "$OUTPUT_DIR")"
mkdir -p "$OUTPUT_PARENT"
TEMP_DIR="$(mktemp -d "$OUTPUT_PARENT/.${OUTPUT_NAME}.tmp.XXXXXX")"
BACKUP_DIR="$OUTPUT_PARENT/.${OUTPUT_NAME}.backup.$$"

cleanup() {
    rm -rf "$TEMP_DIR"
    if [[ -d "$BACKUP_DIR" && ! -e "$OUTPUT_DIR" ]]; then
        mv "$BACKUP_DIR" "$OUTPUT_DIR" || echo "Error: previous bindings remain at $BACKUP_DIR" >&2
    fi
}
trap cleanup EXIT

if ! soroban contract bindings typescript \
    --contract-id "$CONTRACT_ID_VALUE" \
    --rpc-url "$RPC_URL" \
    --network-passphrase "$NETWORK_PASSPHRASE" \
    --output-dir "$TEMP_DIR" >"$TEMP_DIR/.generator.log" 2>&1; then
    echo -e "${RED}Error: Binding generation failed. Check the contract, RPC URL, and network passphrase; existing bindings were preserved.${NC}" >&2
    exit 1
fi

if ! find "$TEMP_DIR" -type f ! -name .generator.log -print -quit | grep -q .; then
    echo -e "${RED}Error: Binding generation returned no files; existing bindings were preserved.${NC}" >&2
    exit 1
fi

rm -f "$TEMP_DIR/.generator.log"
if [[ -e "$OUTPUT_DIR" ]] && ! mv "$OUTPUT_DIR" "$BACKUP_DIR"; then
    echo -e "${RED}Error: Could not stage existing bindings; output was not changed.${NC}" >&2
    exit 1
fi

if ! mv "$TEMP_DIR" "$OUTPUT_DIR"; then
    if [[ -d "$BACKUP_DIR" ]] && ! mv "$BACKUP_DIR" "$OUTPUT_DIR"; then
        echo -e "${RED}Error: Could not install new bindings or restore the previous output; previous bindings remain at $BACKUP_DIR.${NC}" >&2
        exit 1
    fi
    echo -e "${RED}Error: Could not install new bindings; previous bindings were restored.${NC}" >&2
    exit 1
fi

rm -rf "$BACKUP_DIR"
trap - EXIT

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Bindings generated successfully!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "Output location: ${YELLOW}$OUTPUT_DIR/${NC}"
echo ""
echo -e "${GREEN}Next steps:${NC}"
echo "1. Import the client in your frontend service:"
echo "   import { Contract } from '../contracts/generated';"
echo "2. Initialise it with a network passphrase, RPC URL, and contract ID."
echo "3. Replace the relevant fetch() calls in frontend/src/services/api.ts"
echo "   with direct contract method calls (see docs/CONTRACT_BINDINGS.md)."
echo ""