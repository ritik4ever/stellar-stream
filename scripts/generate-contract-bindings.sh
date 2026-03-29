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

set -e

# ── Colors ────────────────────────────────────────────────────────────────
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m'

# ── Config ────────────────────────────────────────────────────────────────
OUTPUT_DIR="frontend/src/contracts/generated"
NETWORK_PASSPHRASE="${NETWORK_PASSPHRASE:-Test SDF Network ; September 2015}"
RPC_URL="${RPC_URL:-https://soroban-testnet.stellar.org:443}"

# ── Checks ────────────────────────────────────────────────────────────────
if [ -z "$CONTRACT_ID" ]; then
    echo -e "${RED}Error: CONTRACT_ID environment variable is required${NC}"
    echo ""
    echo "Deploy the contract first, then re-run:"
    echo "  SECRET_KEY=\"S...\" npm run deploy:contract"
    echo "  CONTRACT_ID=\"C...\" npm run gen:bindings"
    echo ""
    echo "Or read the saved ID directly:"
    echo "  CONTRACT_ID=\$(cat contracts/contract_id.txt) npm run gen:bindings"
    exit 1
fi

if ! command -v soroban &> /dev/null; then
    echo -e "${RED}Error: soroban-cli is not installed${NC}"
    echo "Install it from: https://soroban.stellar.org/docs/getting-started/setup#install-the-soroban-cli"
    exit 1
fi

# ── Run ───────────────────────────────────────────────────────────────────
echo -e "${GREEN}Generating TypeScript bindings...${NC}"
echo "Contract ID : $CONTRACT_ID"
echo "RPC URL     : $RPC_URL"
echo "Output      : $OUTPUT_DIR"
echo ""

# Wipe previous output so stale files don't linger
rm -rf "$OUTPUT_DIR"
mkdir -p "$OUTPUT_DIR"

soroban contract bindings typescript \
    --contract-id "$CONTRACT_ID" \
    --rpc-url "$RPC_URL" \
    --network-passphrase "$NETWORK_PASSPHRASE" \
    --output-dir "$OUTPUT_DIR"

if [ $? -ne 0 ]; then
    echo -e "${RED}Error: Binding generation failed${NC}"
    exit 1
fi

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