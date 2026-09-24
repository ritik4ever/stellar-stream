#!/bin/bash

# Deploy StellarStream contract to Stellar testnet
#
# Required environment variables:
#   SECRET_KEY - Stellar account secret key for deployment
#
# Optional environment variables:
#   NETWORK_PASSPHRASE - Network passphrase (defaults to testnet)
#   RPC_URL            - RPC endpoint URL (defaults to testnet)
#   SKIP_HASH_CHECK    - Set to "1" to skip hash verification (first-time builds only)
#
# Usage:
#   SECRET_KEY="S..." ./scripts/deploy.sh
#
# Hash verification:
#   On first build: SHA256 hash is computed and saved to contracts/wasm.sha256
#   On subsequent builds: computed hash is verified against contracts/wasm.sha256
#   To regenerate the stored hash (e.g. after a contract code change):
#     SKIP_HASH_CHECK=1 ./scripts/deploy.sh

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
CYAN='\033[0;36m'
NC='\033[0m' # No Color

# Configuration
CONTRACTS_DIR="contracts"
CONTRACT_ID_FILE="contract_id.txt"
WASM_HASH_FILE="wasm.sha256"
NETWORK_PASSPHRASE="${NETWORK_PASSPHRASE:-Test SDF Network ; September 2015}"
RPC_URL="${RPC_URL:-https://soroban-testnet.stellar.org:443}"

# Check for required environment variables
if [ -z "$SECRET_KEY" ]; then
    echo -e "${RED}Error: SECRET_KEY environment variable is required${NC}"
    echo "Please set SECRET_KEY to your Stellar account secret key"
    echo "Example: SECRET_KEY=\"S...\" ./scripts/deploy.sh"
    exit 1
fi

# Check if soroban-cli is installed
if ! command -v soroban &> /dev/null; then
    echo -e "${RED}Error: soroban-cli is not installed${NC}"
    echo "Please install it from: https://soroban.stellar.org/docs/getting-started/setup#install-the-soroban-cli"
    exit 1
fi

# Check sha256sum or shasum availability
if command -v sha256sum &> /dev/null; then
    SHA256_CMD="sha256sum"
elif command -v shasum &> /dev/null; then
    SHA256_CMD="shasum -a 256"
else
    echo -e "${RED}Error: Neither sha256sum nor shasum is available${NC}"
    echo "Please install coreutils or use a system with sha256sum"
    exit 1
fi

# Check if wasm-opt is installed (optional, but recommended for size optimization)
if ! command -v wasm-opt &> /dev/null; then
    echo -e "${YELLOW}Warning: wasm-opt is not installed${NC}"
    echo "For WASM binary size optimization, install via:"
    echo "  npm install -g wasm-opt  (or)"
    echo "  brew install binaryen"
    echo ""
fi

echo -e "${GREEN}Starting contract deployment...${NC}"
echo "Network: Testnet"
echo "RPC URL: $RPC_URL"
echo ""

# Change to contracts directory
cd "$CONTRACTS_DIR" || exit 1

# Build the contract
echo -e "${YELLOW}Building contract...${NC}"
soroban contract build

if [ $? -ne 0 ]; then
    echo -e "${RED}Error: Contract build failed${NC}"
    exit 1
fi

echo -e "${GREEN}Contract built successfully${NC}"
echo ""

# ─────────────────────────────────────────────
# SHA256 Hash Verification
# ─────────────────────────────────────────────

# soroban contract build produces the optimised binary at wasm32v1-none when
# using a recent toolchain, but falls back to wasm32-unknown-unknown for older
# toolchains. Detect which path was created.
WASM_FILE_V1="target/wasm32v1-none/release/stellar_stream.wasm"
WASM_FILE_LEGACY="target/wasm32-unknown-unknown/release/stellar_stream.wasm"

if [ -f "$WASM_FILE_V1" ]; then
    WASM_FILE="$WASM_FILE_V1"
elif [ -f "$WASM_FILE_LEGACY" ]; then
    WASM_FILE="$WASM_FILE_LEGACY"
else
    echo -e "${RED}Error: WASM binary not found at expected paths:${NC}"
    echo "  $WASM_FILE_V1"
    echo "  $WASM_FILE_LEGACY"
    exit 1
fi

# Compute SHA256 of the built WASM
echo -e "${CYAN}Computing SHA256 of WASM binary...${NC}"
COMPUTED_HASH=$($SHA256_CMD "$WASM_FILE" | awk '{print $1}')
echo -e "Computed SHA256: ${YELLOW}${COMPUTED_HASH}${NC}"
echo ""

# Profile WASM binary size
SIZE_BYTES=$(stat -f%z "$WASM_FILE" 2>/dev/null || stat -c%s "$WASM_FILE" 2>/dev/null || echo "0")
SIZE_KB=$(echo "scale=2; $SIZE_BYTES / 1024" | bc 2>/dev/null || echo "unknown")
echo -e "${GREEN}WASM binary size: ${SIZE_KB}KB (${SIZE_BYTES} bytes)${NC}"
echo ""

if [ -f "$WASM_HASH_FILE" ]; then
    # Hash file exists — strip comments and extract the stored hash
    STORED_HASH=$(grep -v '^#' "$WASM_HASH_FILE" | grep -v '^[[:space:]]*$' | awk '{print $1}' | head -n 1)

    if [ -z "$STORED_HASH" ]; then
        # File exists but contains only comments (placeholder state) — write initial hash
        echo -e "${YELLOW}Hash file exists but has no stored hash. Writing initial hash.${NC}"
        echo "$COMPUTED_HASH  $WASM_FILE" >> "$WASM_HASH_FILE"
        echo -e "${GREEN}Updated $WASM_HASH_FILE with initial hash.${NC}"
        echo -e "${YELLOW}Commit this file to version control to enable future hash verification.${NC}"
    elif [ "$SKIP_HASH_CHECK" = "1" ]; then
        echo -e "${YELLOW}⚠  SKIP_HASH_CHECK=1: Skipping hash verification and updating stored hash.${NC}"
        # Replace the data line (keep comments) or append fresh hash line
        grep '^#' "$WASM_HASH_FILE" > "${WASM_HASH_FILE}.tmp" || true
        echo "$COMPUTED_HASH  $WASM_FILE" >> "${WASM_HASH_FILE}.tmp"
        mv "${WASM_HASH_FILE}.tmp" "$WASM_HASH_FILE"
        echo -e "${GREEN}Updated $WASM_HASH_FILE with new hash.${NC}"
    elif [ "$COMPUTED_HASH" = "$STORED_HASH" ]; then
        echo -e "${CYAN}Stored  SHA256: ${YELLOW}${STORED_HASH}${NC}"
        echo -e "${GREEN}✔ Hash verification PASSED — WASM binary is reproducible.${NC}"
    else
        echo -e "${CYAN}Stored  SHA256: ${YELLOW}${STORED_HASH}${NC}"
        echo ""
        echo -e "${RED}╔══════════════════════════════════════════════════════════════╗${NC}"
        echo -e "${RED}║          ⚠  HASH MISMATCH — DEPLOYMENT ABORTED  ⚠           ║${NC}"
        echo -e "${RED}╠══════════════════════════════════════════════════════════════╣${NC}"
        echo -e "${RED}║  The WASM binary does not match the stored hash.             ║${NC}"
        echo -e "${RED}║  This may indicate:                                          ║${NC}"
        echo -e "${RED}║    • A supply-chain compromise                               ║${NC}"
        echo -e "${RED}║    • A toolchain change (compiler version, flags, etc.)      ║${NC}"
        echo -e "${RED}║    • Intentional contract source changes                     ║${NC}"
        echo -e "${RED}║                                                              ║${NC}"
        echo -e "${RED}║  Expected: ${STORED_HASH}  ║${NC}"
        echo -e "${RED}║  Computed: ${COMPUTED_HASH}  ║${NC}"
        echo -e "${RED}║                                                              ║${NC}"
        echo -e "${RED}║  If this change is intentional, regenerate the hash:         ║${NC}"
        echo -e "${RED}║    SKIP_HASH_CHECK=1 ./scripts/deploy.sh                     ║${NC}"
        echo -e "${RED}╚══════════════════════════════════════════════════════════════╝${NC}"
        exit 1
    fi
else
    # No hash file exists yet — create it (first-time build)
    echo -e "${YELLOW}No stored hash found. Saving hash to ${WASM_HASH_FILE} (first-time build).${NC}"
    echo "$COMPUTED_HASH  $WASM_FILE" > "$WASM_HASH_FILE"
    echo -e "${GREEN}Saved SHA256 hash to ${WASM_HASH_FILE}${NC}"
    echo -e "${YELLOW}Commit this file to version control to enable future hash verification.${NC}"
fi

echo ""

# Deploy the contract
echo -e "${YELLOW}Deploying contract to testnet...${NC}"

# Capture both stdout and stderr, but check exit code separately
DEPLOY_OUTPUT=$(soroban contract deploy \
    --wasm target/wasm32v1-none/release/stellar_stream.wasm \
    --source-account "$SECRET_KEY" \
    --network testnet \
    --network-passphrase "$NETWORK_PASSPHRASE" \
    --rpc-url "$RPC_URL" \
    2>&1)
DEPLOY_EXIT_CODE=$?

if [ $DEPLOY_EXIT_CODE -ne 0 ]; then
    echo -e "${RED}Error: Contract deployment failed${NC}"
    echo "$DEPLOY_OUTPUT"
    exit 1
fi

# Extract contract ID (soroban-cli outputs it directly, may have whitespace)
CONTRACT_ID=$(echo "$DEPLOY_OUTPUT" | grep -oE '[A-Z0-9]{56}' | head -n 1)

# If no 56-char match found, try trimming whitespace from the output
if [ -z "$CONTRACT_ID" ]; then
    CONTRACT_ID=$(echo "$DEPLOY_OUTPUT" | tr -d '[:space:]')
fi

# Validate contract ID format (Stellar contract IDs are 56 characters)
if [ ${#CONTRACT_ID} -ne 56 ]; then
    echo -e "${RED}Error: Invalid contract ID format${NC}"
    echo "Expected 56 characters, got: ${#CONTRACT_ID}"
    echo "Output was: $DEPLOY_OUTPUT"
    exit 1
fi

# Save contract ID to file
echo "$CONTRACT_ID" > "$CONTRACT_ID_FILE"

# Return to root directory
cd ..

echo ""
echo -e "${GREEN}========================================${NC}"
echo -e "${GREEN}Contract deployed successfully!${NC}"
echo -e "${GREEN}========================================${NC}"
echo ""
echo -e "Contract ID:   ${YELLOW}$CONTRACT_ID${NC}"
echo -e "Saved to:      ${YELLOW}$CONTRACTS_DIR/$CONTRACT_ID_FILE${NC}"
echo -e "WASM SHA256:   ${YELLOW}$COMPUTED_HASH${NC}"
echo -e "Hash file:     ${YELLOW}$CONTRACTS_DIR/$WASM_HASH_FILE${NC}"
echo ""
echo -e "${GREEN}Next steps:${NC}"
echo "1. Set CONTRACT_ID=$CONTRACT_ID in your backend .env file"
echo "2. Ensure SERVER_PRIVATE_KEY is set in your backend .env file"
echo "3. Restart your backend service"
echo ""
