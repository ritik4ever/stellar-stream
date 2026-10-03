#!/bin/bash

# Deploy StellarStream contract to a Stellar network (testnet or mainnet)
# 
# Required environment variables:
#   SECRET_KEY - Stellar account secret key for deployment
#
# Optional environment variables:
#   STELLAR_NETWORK - "testnet" (default) or "mainnet" (aliases: public, main)
#   NETWORK_PASSPHRASE - Network passphrase (defaults to the selected network)
#   RPC_URL - RPC endpoint URL (defaults to the selected network)
#
# Failure modes (issue #1205):
#   - missing SECRET_KEY                 -> exits 1 before any build/deploy
#   - malformed SECRET_KEY               -> exits 1 before any build/deploy
#   - unknown STELLAR_NETWORK value      -> exits 1 before any build/deploy
#   - RPC_URL/network mismatch           -> exits 1 before any build/deploy
#   - RPC endpoint/credentials rejected  -> exits 1 before any build/deploy
#   - soroban-cli missing                -> exits 1 before any build/deploy
# All failures happen before `soroban contract deploy` runs, so a failed run
# never leaves a half-deployed contract or overwrites contracts/contract_id.txt.
#
# Usage:
#   SECRET_KEY="S..." ./scripts/deploy.sh                      # testnet
#   SECRET_KEY="S..." STELLAR_NETWORK=mainnet ./scripts/deploy.sh

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
CONTRACTS_DIR="contracts"
CONTRACT_ID_FILE="contract_id.txt"

# Network profile selection (issue #1205). RPC_URL and NETWORK_PASSPHRASE
# defaults follow the selected network so a mainnet deployment cannot silently
# talk to a testnet endpoint.
STELLAR_NETWORK="$(echo "${STELLAR_NETWORK:-testnet}" | tr '[:upper:]' '[:lower:]' | tr -d '[:space:]')"
case "$STELLAR_NETWORK" in
    testnet|test)
        STELLAR_NETWORK="testnet"
        DEFAULT_RPC_URL="https://soroban-testnet.stellar.org:443"
        DEFAULT_NETWORK_PASSPHRASE="Test SDF Network ; September 2015"
        ;;
    mainnet|public|main)
        STELLAR_NETWORK="mainnet"
        DEFAULT_RPC_URL="https://soroban-rpc.stellar.org:443"
        DEFAULT_NETWORK_PASSPHRASE="Public Global Stellar Network ; September 2015"
        ;;
    *)
        echo -e "${RED}Error: unknown STELLAR_NETWORK "$STELLAR_NETWORK"${NC}"
        echo "Supported values: testnet (default) or mainnet (aliases: public, main)"
        exit 1
        ;;
esac
RPC_URL="${RPC_URL:-$DEFAULT_RPC_URL}"
NETWORK_PASSPHRASE="${NETWORK_PASSPHRASE:-$DEFAULT_NETWORK_PASSPHRASE}"

# Preflight: catch an RPC/network mismatch before building or deploying.
# Only the well-known public endpoints are classified; custom RPC providers are
# assumed to match the selected network.
case "$RPC_URL" in
    *testnet*)
        if [ "$STELLAR_NETWORK" != "testnet" ]; then
            echo -e "${RED}Error: STELLAR_NETWORK=$STELLAR_NETWORK but RPC_URL points at a testnet endpoint${NC}"
            echo "Set RPC_URL=$DEFAULT_RPC_URL or a mainnet RPC provider, or drop STELLAR_NETWORK to deploy to testnet."
            exit 1
        fi
        ;;
    *mainnet*|"https://soroban-rpc.stellar.org:443")
        if [ "$STELLAR_NETWORK" != "mainnet" ]; then
            echo -e "${RED}Error: STELLAR_NETWORK=$STELLAR_NETWORK but RPC_URL points at a mainnet endpoint${NC}"
            echo "Set RPC_URL=$DEFAULT_RPC_URL, or remove it to use the testnet default."
            exit 1
        fi
        ;;
esac
case "$NETWORK_PASSPHRASE" in
    "$DEFAULT_NETWORK_PASSPHRASE") : ;;
    "Test SDF Network ; September 2015")
        if [ "$STELLAR_NETWORK" != "testnet" ]; then
            echo -e "${RED}Error: STELLAR_NETWORK=$STELLAR_NETWORK but NETWORK_PASSPHRASE is the testnet passphrase${NC}"
            echo "Align NETWORK_PASSPHRASE with STELLAR_NETWORK (or unset it to use the selected network's default)."
            exit 1
        fi
        ;;
    "Public Global Stellar Network ; September 2015")
        if [ "$STELLAR_NETWORK" != "mainnet" ]; then
            echo -e "${RED}Error: STELLAR_NETWORK=$STELLAR_NETWORK but NETWORK_PASSPHRASE is the mainnet passphrase${NC}"
            echo "Align NETWORK_PASSPHRASE with STELLAR_NETWORK (or unset it to use the selected network's default)."
            exit 1
        fi
        ;;
    *) : ;; # custom passphrase (local standalone node, futurenet) — allowed
esac

# Check for required environment variables
if [ -z "$SECRET_KEY" ]; then
    echo -e "${RED}Error: SECRET_KEY environment variable is required${NC}"
    echo "Please set SECRET_KEY to your Stellar account secret key"
    echo "Example: SECRET_KEY=\"S...\" ./scripts/deploy.sh"
    exit 1
fi
if [ ${#SECRET_KEY} -ne 56 ] || [[ "$SECRET_KEY" != S* ]]; then
    echo -e "${RED}Error: SECRET_KEY must be a 56-character Stellar secret key starting with S${NC}"
    echo "Received a value with ${#SECRET_KEY} characters; value redacted."
    exit 1
fi
# Check if soroban-cli is installed
if ! command -v soroban &> /dev/null; then
    echo -e "${RED}Error: soroban-cli is not installed${NC}"
    echo "Please install it from: https://soroban.stellar.org/docs/getting-started/setup#install-the-soroban-cli"
    exit 1
fi

# Verify the selected RPC endpoint and any provider credentials before building.
if ! node backend/scripts/rpc-preflight.cjs; then
    echo -e "${RED}Error: Stellar RPC preflight failed; no contract build or deployment was started${NC}"
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
echo "Network: $STELLAR_NETWORK"
echo "RPC endpoint: configured (credentials redacted)"
echo "Passphrase: $NETWORK_PASSPHRASE"
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

# Profile WASM binary size (informational only; prefers the deployed artifact)
WASM_FILE="target/wasm32v1-none/release/stellar_stream.wasm"
if [ ! -f "$WASM_FILE" ]; then
    WASM_FILE="target/wasm32-unknown-unknown/release/stellar_stream.wasm"
fi
if [ -f "$WASM_FILE" ]; then
    SIZE_BYTES=$(stat -f%z "$WASM_FILE" 2>/dev/null || stat -c%s "$WASM_FILE" 2>/dev/null || echo "0")
    SIZE_KB=$(echo "scale=2; $SIZE_BYTES / 1024" | bc 2>/dev/null || echo "unknown")
    echo -e "${GREEN}WASM binary size: ${SIZE_KB}KB (${SIZE_BYTES} bytes)${NC}"

    # If wasm-opt is available, show optimization impact (dry run)
    if command -v wasm-opt &> /dev/null; then
        echo -e "${YELLOW}wasm-opt is available. Build script will optimize binary.${NC}"
    fi
    echo ""
else
    echo -e "${YELLOW}Warning: Could not find WASM binary at $WASM_FILE${NC}"
fi

echo -e "${GREEN}Contract built successfully${NC}"
echo ""

# Deploy the contract
echo -e "${YELLOW}Deploying contract to $STELLAR_NETWORK...${NC}"

# Capture both stdout and stderr, but check exit code separately
DEPLOY_ARGS=(
    --wasm target/wasm32v1-none/release/stellar_stream.wasm
    --source-account "$SECRET_KEY"
    --network "$STELLAR_NETWORK"
    --network-passphrase "$NETWORK_PASSPHRASE"
    --rpc-url "$RPC_URL"
)
if DEPLOY_OUTPUT=$(soroban contract deploy "${DEPLOY_ARGS[@]}" 2>&1); then
    DEPLOY_EXIT_CODE=0
else
    DEPLOY_EXIT_CODE=$?
fi

if [ $DEPLOY_EXIT_CODE -ne 0 ]; then
    echo -e "${RED}Error: Contract deployment failed (CLI exit $DEPLOY_EXIT_CODE)${NC}"
    echo "Raw CLI output is suppressed to avoid exposing RPC credentials. Check the RPC provider, network selection, and deployer funding."
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
echo -e "Network: ${YELLOW}$STELLAR_NETWORK${NC}"
echo -e "Contract ID: ${YELLOW}$CONTRACT_ID${NC}"
echo -e "Saved to: ${YELLOW}$CONTRACTS_DIR/$CONTRACT_ID_FILE${NC}"
echo ""
echo -e "${GREEN}Next steps:${NC}"
echo "1. Set CONTRACT_ID=$CONTRACT_ID in your backend .env file"
echo "2. Ensure SERVER_PRIVATE_KEY is set in your backend .env file"
echo "3. Set STELLAR_NETWORK=$STELLAR_NETWORK in your backend .env file"
echo "4. Restart your backend service"
echo ""
