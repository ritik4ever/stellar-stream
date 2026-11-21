# Frequently Asked Questions (FAQ)

This document addresses common questions and issues encountered by contributors and developers working on StellarStream.

## Table of Contents
1. [How do I run the backend without Stellar credentials?](#how-do-i-run-the-backend-without-stellar-credentials)
2. [How do I get testnet XLM?](#how-do-i-get-testnet-xlm)
3. [How do I set up Freighter for development?](#how-do-i-set-up-freighter-for-development)
4. [Why is the indexer circuit breaker open?](#why-is-the-indexer-circuit-breaker-open)
5. [How do I reset the database?](#how-do-i-reset-the-database)
6. [How do I generate a JWT secret?](#how-do-i-generate-a-jwt-secret)
7. [How do I debug WebSocket issues?](#how-do-i-debug-websocket-issues)
8. [How do I run the full project locally?](#how-do-i-run-the-full-project-locally)
9. [How do I run tests?](#how-do-i-run-tests)
10. [How do I update contract bindings?](#how-do-i-update-contract-bindings)
11. [How do I change the allowed assets?](#how-do-i-change-the-allowed-assets)

---

### How do I run the backend without Stellar credentials?
This is the recommended starting point for new contributors who haven't deployed a contract yet (frontend work, API development, running tests).

1. Copy the example env file:
   ```bash
   cp backend/.env.example backend/.env
   ```
2. Uncomment (or add) `SOROBAN_DISABLED=true` in `backend/.env`:
   ```
   SOROBAN_DISABLED=true
   ```
3. Start the backend:
   ```bash
   npm run dev:backend
   ```

What works in this mode:
- All REST API endpoints (streams, webhooks, events, stats).
- WebSocket real-time updates.
- JWT authentication (uses an ephemeral secret that resets on restart).
- All backend unit and integration tests (`cd backend && npm test`).

What doesn't work:
- On-chain stream operations (claim, create, cancel) — these require a deployed contract.
- The event indexer will not start (no `CONTRACT_ID` to watch).

Once you have a deployed contract, remove `SOROBAN_DISABLED=true` and set `CONTRACT_ID` and `SERVER_PRIVATE_KEY` in your `.env`. See [CONTRIBUTING.md](CONTRIBUTING.md) for the full Soroban local testnet setup.

---

### How do I get testnet XLM?
To fund your testnet account, you can use the **Friendbot** service provided by Stellar:
- **Via URL:** Open `https://friendbot.stellar.org/?addr=YOUR_PUBLIC_KEY` in your browser.
- **Via CLI:** `curl "https://friendbot.stellar.org/?addr=YOUR_PUBLIC_KEY"`
- **Via Laboratory:** Use the [Stellar Laboratory Account Creator](https://laboratory.stellar.org/#account-creator?network=testnet).

### How do I set up Freighter for development?
1. Install the extension from [freighter.app](https://www.freighter.app/).
2. Open Freighter settings (gear icon) -> **Network Settings**.
3. Ensure the network is set to **Test Net**.
4. Create or import an account. Use Friendbot (see above) to fund it.

### Why is the indexer circuit breaker open?
The indexer circuit breaker opens when it encounters 5 consecutive failures while communicating with the Stellar RPC node. This is a safety mechanism to prevent flooding a failing node with requests.
- **Status:** Check logs for `[Circuit Breaker] State Transition`.
- **Recovery:** The circuit stays `OPEN` for 60 seconds (default) before transitioning to `HALF_OPEN` to test a single request. If it succeeds, it returns to `CLOSED`.
- **Configuration:** See `CIRCUIT_BREAKER_TIMEOUT_MS` in [indexer.ts](backend/src/services/indexer.ts).

### How do I reset the database?
If you need a fresh start with the backend data:
1. Stop the backend server.
2. Delete the SQLite database file:
   ```bash
   rm backend/data/streams.db
   ```
3. Restart the backend. The database and tables will be automatically recreated by the migration layer in [db.ts](backend/src/services/db.ts).

### How do I generate a JWT secret?
The `JWT_SECRET` in `backend/.env` should be a strong, random string. You can generate one using:
```bash
openssl rand -hex 32
```
Add the output to your `backend/.env` file.

### How do I debug WebSocket issues?
The frontend uses WebSockets for real-time updates. If updates aren't appearing:
1. Open Browser DevTools -> **Network** tab.
2. Filter by **WS** (WebSockets).
3. Check if the connection to `ws://localhost:3001` is successful.
4. Look for messages in the **Frames** or **Messages** sub-tab.
5. Check [useWebSocket.ts](frontend/src/hooks/useWebSocket.ts) for reconnection logic.

### How do I run the full project locally?
The easiest way is to use the root-level scripts:
```bash
# Install all dependencies
npm run install:all

# Start frontend, backend, and indexer in development mode
npm run dev
```
See the [README.md](README.md) for more details.

### How do I run tests?
- **Backend:** `cd backend && npm test`. See [TESTING.md](backend/TESTING.md) for integration test details.
- **Contracts:** `cd contracts && cargo test`.
- **Frontend:** `cd frontend && npm test`.

### How do I update contract bindings?
If you've modified the Soroban contract and want to update the TypeScript clients:
```bash
./scripts/generate-contract-bindings.sh
```
Refer to [CONTRACT_BINDINGS.md](docs/CONTRACT_BINDINGS.md) for requirements.

### How do I change the allowed assets?
The assets allowed for streaming are configured in the backend environment:
1. Edit `ALLOWED_ASSETS` in `backend/.env` (comma-separated list, e.g., `USDC,XLM,ARS`).
2. Restart the backend server.
3. The frontend and API validation will automatically pick up the new list.
