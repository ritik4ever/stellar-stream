#!/bin/bash

# Deploy StellarStream contract to Stellar testnet
# 
# Required environment variables:
#   SECRET_KEY - Stellar account secret key for deployment
#
# Optional environment variables:
#   NETWORK_PASSPHRASE - Network passphrase (defaults to testnet)
#   RPC_URL - RPC endpoint URL (defaults to testnet)
#
# Usage:
#   SECRET_KEY="S..." ./scripts/deploy.sh

set -e

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Configuration
CONTRACTS_DIR="contracts"
CONTRACT_ID_FILE="contract_id.txt"
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
echo -e "Contract ID: ${YELLOW}$CONTRACT_ID${NC}"
echo -e "Saved to: ${YELLOW}$CONTRACTS_DIR/$CONTRACT_ID_FILE${NC}"
echo ""
echo -e "${GREEN}Next steps:${NC}"
echo "1. Set CONTRACT_ID=$CONTRACT_ID in your backend .env file"
echo "2. Ensure SERVER_PRIVATE_KEY is set in your backend .env file"
echo "3. Restart your backend service"
echo ""
