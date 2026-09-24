# Troubleshooting Guide

Common issues encountered when developing or deploying StellarStream, organized by area.

---

## Table of Contents

1. [SOROBAN_DISABLED Mode Confusion](#1-soroban_disabled-mode-confusion)
2. [CONTRACT_ID Format Errors](#2-contract_id-format-errors)
3. [Indexer Not Starting](#3-indexer-not-starting)
4. [SQLite Lock Errors](#4-sqlite-lock-errors)
5. [Freighter Wallet Not Detected](#5-freighter-wallet-not-detected)

---

## 1. SOROBAN_DISABLED Mode Confusion

### 1.1 Backend exits on startup with Soroban config error

**Symptom:** Backend immediately exits, logging:

```
❌ Soroban configuration incomplete. Either provide both CONTRACT_ID and SERVER_PRIVATE_KEY, or set SOROBAN_DISABLED=true for local development.
```

**Cause:** Neither `CONTRACT_ID`/`SERVER_PRIVATE_KEY` nor `SOROBAN_DISABLED=true` is set. The default assumes Soroban is enabled and requires both variables.

**Fix:** For local development without on-chain operations, add to `backend/.env`:

```bash
echo 'SOROBAN_DISABLED=true' >> backend/.env
```

For production, set `CONTRACT_ID` and `SERVER_PRIVATE_KEY`.

---

### 1.2 Warning about SERVER_PRIVATE_KEY with SOROBAN_DISABLED

**Symptom:** Backend logs:

```
⚠️  SOROBAN_DISABLED=true is set and SERVER_PRIVATE_KEY is configured. The private key will not be used or logged in disabled mode.
```

**Cause:** Both `SOROBAN_DISABLED=true` and `SERVER_PRIVATE_KEY` are set simultaneously. The private key is ignored in disabled mode.

**Fix:** This is harmless. To silence the warning, remove `SERVER_PRIVATE_KEY` from `backend/.env` when running in disabled mode:

```bash
# Remove the SERVER_PRIVATE_KEY line from backend/.env
```

---

### 1.3 Indexer never starts in local dev mode

**Symptom:** Backend starts but indexer never runs. Logs show:

```
CONTRACT_ID not set, event indexer will not start
```

**Cause:** `SOROBAN_DISABLED=true` prevents the indexer from starting. This is intentional — local development mode skips Soroban polling.

**Fix:** This is expected behavior when `SOROBAN_DISABLED=true`. Streams created via the API will still work locally, but on-chain events (e.g., claims submitted via Freighter on testnet) will not be indexed. To re-enable, remove `SOROBAN_DISABLED` and configure `CONTRACT_ID`, `SERVER_PRIVATE_KEY`, and `RPC_URL`.

---

## 2. CONTRACT_ID Format Errors

### 2.1 CONTRACT_ID wrong length

**Symptom:** Backend exits with:

```
CONTRACT_ID validation failed
CONTRACT_ID validation issue: must be exactly 56 characters
```

**Cause:** The value set for `CONTRACT_ID` is not exactly 56 characters long.

**Fix:** Verify the length and fetch the correct ID:

```bash
# Check current length
echo ${#CONTRACT_ID}

# Retrieve the deployed contract ID
cat contracts/contract_id.txt

# Or re-deploy and capture the ID
cd contracts && make build
soroban contract deploy --wasm target/wasm32-unknown-unknown/release/stellar_stream.wasm --network testnet
```

Set the correct 56-character value in `backend/.env`:

```ini
CONTRACT_ID=C...
```

---

### 2.2 CONTRACT_ID uses G-prefixed account instead of C-prefixed contract

**Symptom:** Backend exits with:

```
CONTRACT_ID validation failed
CONTRACT_ID validation issue: must start with C (contract)
```

**Cause:** A Stellar account public key (starts with `G`) was used instead of a deployed contract ID (starts with `C`).

**Fix:** Deploy the contract to get a `C`-prefixed ID:

```bash
cd contracts && make build
soroban contract deploy \
  --wasm target/wasm32-unknown-unknown/release/stellar_stream.wasm \
  --network testnet
```

Save the returned `C...` value as `CONTRACT_ID` in `backend/.env`.

---

### 2.3 Frontend claims fail with missing VITE_CONTRACT_ID

**Symptom:** Claiming a stream via the frontend fails. Browser console shows:

```
Missing VITE_CONTRACT_ID; cannot submit Soroban claim.
```

**Cause:** `VITE_CONTRACT_ID` is not set in `frontend/.env`. The frontend cannot submit on-chain claim transactions without it.

**Fix:** Set `VITE_CONTRACT_ID` to the same value as `CONTRACT_ID` in `frontend/.env`:

```bash
echo "VITE_CONTRACT_ID=<same value as backend CONTRACT_ID>" >> frontend/.env
```

Then restart the frontend dev server.

---

## 3. Indexer Not Starting

### 3.1 "CONTRACT_ID not set" warning

**Symptom:** Backend logs:

```
CONTRACT_ID not set, event indexer will not start
```

**Cause:** Either `SOROBAN_DISABLED=true` (see [1.3](#13-indexer-never-starts-in-local-dev-mode)) or `CONTRACT_ID` is missing from the environment.

**Fix:** Check which case applies:

```bash
grep SOROBAN_DISABLED backend/.env
grep CONTRACT_ID backend/.env
```

If `SOROBAN_DISABLED=true` is present, this warning is expected. Otherwise, set `CONTRACT_ID` (see [section 2](#2-contract_id-format-errors)).

---

### 3.2 Circuit breaker open — RPC unreachable

**Symptom:** Logs show repeated:

```
[Circuit Breaker] State Transition: CLOSED -> OPEN
```

Followed by the indexer skipping polls.

**Cause:** The indexer failed 5 consecutive requests to the Stellar RPC node. Common reasons: incorrect `RPC_URL`, network outage, or rate limiting.

**Fix:**

```bash
# Verify RPC URL is correct
grep RPC_URL backend/.env

# Test connectivity
curl -s -o /dev/null -w "%{http_code}" https://soroban-testnet.stellar.org

# Check circuit breaker status via the API
curl http://localhost:3001/api/health
```

The circuit breaker automatically transitions to `HALF_OPEN` after 60 seconds (configurable via `CIRCUIT_BREAKER_TIMEOUT_MS`). If the RPC is healthy, it will recover automatically.

---

### 3.3 Invalid INDEXER_START_LEDGER

**Symptom:** Backend logs:

```
invalid INDEXER_START_LEDGER value
```

**Cause:** `INDEXER_START_LEDGER` environment variable is set to a non-numeric value.

**Fix:** Set a valid ledger sequence number or remove the variable:

```bash
# Remove the invalid value
unset INDEXER_START_LEDGER

# Or set a valid ledger sequence
echo "INDEXER_START_LEDGER=12345678" >> backend/.env
```

---

## 4. SQLite Lock Errors

### 4.1 Database locked in production

**Symptom:** Backend throws `SQLITE_BUSY` errors or requests hang.

**Cause:** Multiple backend processes are writing to the same SQLite database file. SQLite has limited concurrency.

**Fix:**

```bash
# Check for multiple backend processes
Get-Process -Name node -ErrorAction SilentlyContinue | Select-Object Id, StartTime

# Ensure only one instance is running
# Kill stale processes if needed
```

SQLite WAL mode and `busy_timeout=5000` are already enabled in `db.ts`, which mitigates most contention. The definitive fix is ensuring only one backend instance writes to the database.

---

### 4.2 Test database locked

**Symptom:** Backend tests fail with database locked errors.

**Cause:** A prior test run was interrupted, leaving the test database in a locked state.

**Fix:** Delete the test database and re-run:

```bash
rm -f backend/data/test-streams.db
cd backend && npm test
```

The database and schema are recreated automatically on next run.

---

## 5. Freighter Wallet Not Detected

### 5.1 Wallet button shows "Install Freighter" despite extension installed

**Symptom:** The wallet button in the UI displays "Install Freighter" even though the Freighter extension is installed.

**Cause:** Freighter may not be injected into the page (incognito mode, disabled extension, or page loaded before extension activated).

**Fix:**

1. Refresh the page fully (Ctrl+Shift+R).
2. Check that Freighter is enabled in browser extensions (chrome://extensions or about:addons).
3. Ensure the extension has permission to access `localhost`.
4. Reinstall from [freighter.app](https://freighter.app) if the issue persists.

---

### 5.2 Freighter installed but connection never completes

**Symptom:** Freighter is installed, but clicking "Connect Wallet" either does nothing or stays in "Connecting..." state.

**Cause:** Freighter is configured for **Public Network** instead of **Test Net**. The app expects testnet, and the SEP-10 challenge signatures fail.

**Fix:**

1. Click the Freighter extension icon in the browser toolbar.
2. Open **Settings** (gear icon).
3. Under **Network**, select **Test Net**.
4. Retry connecting.

---

### 5.3 "Connection cancelled" error

**Symptom:** Clicking "Connect Wallet" shows:

```
Connection cancelled — please approve the request in Freighter.
```

**Cause:** The Freighter popup was dismissed or declined without signing the approval.

**Fix:** Click "Connect Wallet" again and make sure to approve the request in the Freighter popup when it appears. The popup may be hidden behind the browser window.