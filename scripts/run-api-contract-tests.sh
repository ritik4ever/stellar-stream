#!/usr/bin/env bash
set -eo pipefail

PORT=${PORT:-3001}
BASE_URL="http://127.0.0.1:${PORT}"
SPEC_URL="${BASE_URL}/api/docs/openapi.json"

echo "=== Starting API Contract Tests with Schemathesis ==="

SERVER_PID=""

cleanup() {
  if [ -n "$SERVER_PID" ]; then
    echo "Stopping local test server (PID: $SERVER_PID)..."
    kill "$SERVER_PID" 2>/dev/null || true
    wait "$SERVER_PID" 2>/dev/null || true
  fi
}
trap cleanup EXIT INT TERM

# Ensure backend dependencies are installed
if [ ! -d "backend/node_modules" ]; then
  echo "Installing backend dependencies..."
  (cd backend && npm ci)
fi

echo "Starting local test server..."
export SOROBAN_DISABLED=true
export PORT=$PORT
export NODE_ENV=test
export JWT_SECRET="test-jwt-secret-for-schemathesis-contract-testing"

(cd backend && npx ts-node src/index.ts) &
SERVER_PID=$!

echo "Waiting for test server at ${BASE_URL}/api/health..."
MAX_RETRIES=30
RETRY=0
HEALTHY=0

while [ $RETRY -lt $MAX_RETRIES ]; do
  if curl -s "${BASE_URL}/api/health" | grep -q '"status":"ok"'; then
    HEALTHY=1
    break
  fi
  RETRY=$((RETRY + 1))
  sleep 1
done

if [ $HEALTHY -ne 1 ]; then
  echo "Error: Local test server failed to start within 30 seconds."
  exit 1
fi

echo "Test server is running healthy."

# Check/install Schemathesis
if ! command -v schemathesis &> /dev/null; then
  echo "Schemathesis not found. Installing schemathesis..."
  pip install --quiet schemathesis
fi

echo "Running Schemathesis API contract tests..."
schemathesis run "$SPEC_URL" \
  --base-url "$BASE_URL" \
  --checks all \
  --hypothesis-max-examples 30 \
  --suppress-health-check data_too_large,filter_too_much

echo "=== API Contract Tests Passed Successfully ==="
