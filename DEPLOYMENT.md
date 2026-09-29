# Deployment Guide

This guide provides step-by-step instructions for deploying StellarStream to various platforms and using Docker.

## Table of Contents
1. [Stellar Smart Contract Deployment](#1-stellar-smart-contract-deployment)
2. [Backend Deployment (Render)](#2-backend-deployment-render)
3. [Frontend Deployment (Vercel)](#3-frontend-deployment-vercel)
4. [Post-Deploy Verification](#4-post-deploy-verification)
5. [Deployment Failure Recovery](#5-deployment-failure-recovery)
6. [Docker Deployment](#6-docker-deployment)
7. [Troubleshooting](#7-troubleshooting)

---

## 1. Stellar Smart Contract Deployment

Before deploying the backend, you must deploy the Soroban smart contract. The deployment target defaults to the Stellar **Testnet**; production deployments use **Mainnet**.

### Choose the Network First

The network is selected with `STELLAR_NETWORK` (`testnet` — the default — or `mainnet`, alias `public`). Pick it **before** deploying, because the contract ID, RPC endpoint, and network passphrase are all network-specific, and the backend refuses to start when they disagree:

| `STELLAR_NETWORK` | RPC default | Passphrase default |
|---|---|---|
| `testnet` (default) | `https://soroban-testnet.stellar.org:443` | `Test SDF Network ; September 2015` |
| `mainnet` / `public` | `https://soroban-rpc.stellar.org:443` | `Public Global Stellar Network ; September 2015` |

> **Mainnet caution**: mainnet uses real funds. Use a dedicated deployment account, keep the secret key in a secret manager (not shell history), and set `ADMIN_API_KEY` and `JWT_SECRET` before going live.

### Prerequisites
- [Soroban CLI](https://soroban.stellar.org/docs/getting-started/setup#install-the-soroban-cli) installed.
- A Stellar account funded on the **target** network (testnet XLM via Friendbot for testnet; your own funding for mainnet).

### Funding Your Account (Testnet)
1. Generate a new keypair if you don't have one:
   ```bash
   soroban config identity generate deployer
   ```
2. Fund it via Friendbot:
   ```bash
   curl "https://friendbot.stellar.org/?addr=$(soroban config identity address deployer)"
   ```

### Deployment Steps
1. Navigate to the root directory.
2. Run the deployment script (replace with your secret key):
   ```bash
   SECRET_KEY="YOUR_SECRET_KEY" ./scripts/deploy.sh                        # testnet (default)
   SECRET_KEY="YOUR_SECRET_KEY" STELLAR_NETWORK=mainnet ./scripts/deploy.sh # mainnet
   ```
3. Note the **Contract ID** output (also saved in `contracts/contract_id.txt`). You will need this for the backend configuration.

The script performs its own preflight checks and exits **1 before building or deploying** when: `SECRET_KEY` is missing, `soroban-cli` is not installed, `STELLAR_NETWORK` is not a recognized network, or `RPC_URL`/`NETWORK_PASSPHRASE` point at a different network than `STELLAR_NETWORK`. A failed run therefore never leaves a half-deployed contract or overwrites `contracts/contract_id.txt` — fix the reported variable and re-run.

> **Note**: The deploy script still names the Soroban CLI v21 `--network` flag value (`testnet`/`mainnet`); older CLI versions may not recognize the `mainnet` alias — if your CLI rejects it, keep the flag but pass your RPC and passphrase explicitly as the script does.

---

## 2. Backend Deployment (Render)

The backend is a Node.js Express app (TypeScript, compiled to JS) that uses a SQLite database. This guide walks through deploying it on [Render](https://render.com) as a Web Service.

> **⚠️ Frontend package.json**: Before deploying, ensure `frontend/package.json` exists and is not empty. If it's missing or 0 bytes, restore it from git with `git checkout frontend/package.json`.

### Prerequisites
- A [Render](https://render.com) account
- Your GitHub repository connected to Render
- A deployed Stellar smart contract (see [Section 1](#1-stellar-smart-contract-deployment))

### Step 1: Create a Render Web Service

1. From the Render Dashboard, click **New +** → **Web Service**.
2. Connect your GitHub repository and select the repo.
3. Configure the service:
   - **Name**: `stellar-stream-backend` (or your preferred name)
   - **Root Directory**: `backend`
   - **Runtime**: `Node`
   - **Build Command**: `npm run build`
   - **Start Command**: `npm start`
   - **Plan**: Free (or choose a paid plan for better performance)

### Step 2: Add a Persistent Disk

SQLite stores data in a single file. Render's ephemeral filesystem is reset on every deploy, so you **must** mount a persistent disk to preserve the database.

1. In your Render Web Service dashboard, go to **Disks**.
2. Click **Add Disk**.
3. Configure:
   - **Name**: `streams-data`
   - **Mount Path**: `/data`
   - **Size**: 1 GB (sufficient for thousands of streams)
4. Click **Save**.

### Step 3: Configure Environment Variables

Add the following environment variables in your Render Web Service dashboard under **Environment**.

| Variable | Required | Example Value | Description |
|---|---|---|---|
| `PORT` | No | `3001` | Internal port (Render sets this automatically) |
| `STELLAR_NETWORK` | No | `testnet` | `testnet` or `mainnet` (alias `public`); must match `RPC_URL` and `NETWORK_PASSPHRASE` |
| `CONTRACT_ID` | **Yes** | `C...` | Soroban contract ID from [Section 1](#1-stellar-smart-contract-deployment) — **deployed on the same network** |
| `SERVER_PRIVATE_KEY` | **Yes** | `S...` | Stellar secret key for the server account |
| `JWT_SECRET` | **Yes** | `openssl rand -hex 32` | Secret used to sign JWT tokens |
| `ADMIN_API_KEY` | **Yes** | `openssl rand -hex 32` | Admin API key (min 32 chars) |
| `DB_PATH` | **Yes** | `/data/streams.db` | Path to SQLite file on the persistent disk |
| `ALLOWED_ASSETS` | No | `USDC,XLM` | Comma-separated list of allowed asset codes |
| `ALLOWED_ORIGINS` | **Yes** | `https://your-app.vercel.app` | Frontend URL(s) for CORS (comma-separated) |
| `RPC_URL` | No | `https://soroban-testnet.stellar.org:443` | Stellar RPC endpoint; must belong to `STELLAR_NETWORK` |
| `NETWORK_PASSPHRASE` | No | `Test SDF Network ; September 2015` | Stellar network passphrase; must match `STELLAR_NETWORK` |
| `HORIZON_URL` | No | `https://horizon-testnet.stellar.org` | Stellar Horizon endpoint |
| `WEBHOOK_DESTINATION_URL` | No | `https://your-app.com/webhooks` | URL for webhook delivery (optional) |
| `WEBHOOK_SIGNING_SECRET` | No | *(generate a random string)* | HMAC secret for webhook payload signing |
| `INDEXER_POLL_INTERVAL_MS` | No | `10000` | How often (ms) to poll Stellar for events |
| `RECONCILIATION_INTERVAL_MS` | No | `60000` | How often (ms) to reconcile local state with chain |

Generate secrets with:
```bash
openssl rand -hex 32
```

> **Important**: `DB_PATH` **must** point to the persistent disk mount path (`/data/streams.db`). If you use the default (`data/streams.db` relative to the app directory), data will be lost on every deploy.

### Step 4: Health Check

In your Render Web Service settings, set:
- **Health Check Path**: `/api/health`

Render will poll this endpoint every 5 seconds. A `200 OK` response with `{"status":"ok"}` means the service is healthy.

### Step 5: Deploy

1. Click **Create Web Service**. Render will clone your repo, install deps, run the build, and start the server.
2. Watch the **Logs** tab for any errors. A successful start looks like:
   ```
   Server started on port 3001
   Indexer started, polling every 10000ms
   ```

### SQLite & WAL Mode

- WAL (Write-Ahead Logging) mode is **already enabled** in `db.ts`. This significantly improves concurrent read/write performance.
- WAL mode creates two companion files alongside your database: `streams.db-wal` and `streams.db-shm`. These live on the persistent disk alongside `streams.db`.
- **Do not delete** the `-wal` and `-shm` files while the app is running — doing so can corrupt the database.

---

## 3. Frontend Deployment (Vercel)

The frontend is a React app built with Vite + Tailwind CSS. This guide walks through deploying it on [Vercel](https://vercel.com).

### Prerequisites
- A [Vercel](https://vercel.com) account (log in with GitHub)
- Your backend deployed and accessible at a public URL (see [Section 2](#2-backend-deployment-render))

### Step 1: Create a Vercel Project

1. From the Vercel Dashboard, click **Add New** → **Project**.
2. Import your GitHub repository.
3. Configure the project:
   - **Root Directory**: `frontend`
   - **Framework Preset**: `Vite` (Vercel auto-detects this)
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
   - **Node.js Version**: 20.x (match the backend version)

### Step 2: Environment Variables

Add the following environment variables in the Vercel project settings under **Environment Variables**.

| Variable | Required | Example Value | Description |
|---|---|---|---|
| `VITE_API_URL` | **Yes** | `https://your-backend.onrender.com/api` | URL of your deployed backend API |
| `VITE_CONTRACT_ID` | No | `C...` | Soroban contract ID (if frontend interacts directly with chain) |
| `VITE_RPC_URL` | No | `https://soroban-testnet.stellar.org:443` | Stellar RPC endpoint (same network as the backend) |
| `VITE_NETWORK_PASSPHRASE` | No | `Test SDF Network ; September 2015` | Stellar network passphrase (same network as the backend) |

> `VITE_API_URL` is the **most important** variable. It must point to your Render backend URL with the `/api` suffix. Example: `https://stellar-stream-backend.onrender.com/api`.

### Step 3: Deploy

1. Click **Deploy**. Vercel will build and deploy the frontend automatically.
2. Once complete, Vercel provides a URL like `https://stellar-stream.vercel.app`.
3. Go to your Render backend's environment variables and update `ALLOWED_ORIGINS` to include the Vercel URL.

### SPA Routing

The app uses client-side routing (React Router). Vite's build output is a single-page app — Vercel handles SPA fallback automatically. No additional `vercel.json` or redirect rules are needed.

---

## 4. Post-Deploy Verification

After deploying both the backend and frontend, run these checks to confirm everything is working.

### Backend Health

```bash
curl https://your-backend.onrender.com/api/health
```

**Expected response:**
```json
{
  "service": "stellar-stream-backend",
  "status": "ok",
  "timestamp": "2026-07-29T12:00:00.000Z"
}
```

The health endpoint returns a `200 OK` with `{"status":"ok"}`. If you get a timeout or 5xx, the service may still be starting (see [Cold Start Delays](#cold-start-delays-render-free-tier)).

### API Responding

Test that the API returns stream data (will be empty on first deploy):

```bash
curl https://your-backend.onrender.com/api/streams
```

**Expected response:**
```json
{
  "data": [],
  "total": 0,
  "page": 1,
  "limit": 20
}
```

### Database Working

Verify the stats endpoint, which reads from SQLite:

```bash
curl https://your-backend.onrender.com/api/stats
```

**Expected response:**
```json
{
  "data": {
    "total": 0,
    "active": 0,
    "paused": 0,
    "completed": 0,
    "canceled": 0,
    "scheduled": 0,
    "onChainStreamCount": 0,
    "localStreamCount": 0
  }
}
```

A valid JSON response confirms the database is initialized and queryable.

### Frontend Live

```bash
curl -I https://your-app.vercel.app
```

**Expected response:** A `200 OK` or `304 Not Modified` status with a `content-type: text/html` header.

Also open the URL in a browser and verify:
- The page loads without console errors
- The backend API URL is reachable (check Network tab for API calls)
- Wallet connection flow works (if using Freighter)

### Full Integration Check

```bash
# Set your actual URLs
BACKEND_URL="https://your-backend.onrender.com"
FRONTEND_URL="https://your-app.vercel.app"

echo "--- Backend Health ---"
curl -s $BACKEND_URL/api/health | jq .

echo "--- API Stream List ---"
curl -s $BACKEND_URL/api/streams | jq .

echo "--- Frontend ---"
curl -sI $FRONTEND_URL | head -5

echo "--- CORS Check ---"
curl -s -H "Origin: $FRONTEND_URL" -H "Access-Control-Request-Method: GET" \
  -X OPTIONS $BACKEND_URL/api/streams -w "%{http_code}" -o /dev/null
# Expected: 204
```

> **Note**: The `jq` command is optional — pipe to `python3 -m json.tool` if `jq` is unavailable.

### Verify Chain Connectivity Matches the Selected Network

A healthy HTTP status does not prove the backend is talking to the network you intended. Two checks confirm the network wiring:

```bash
# 1. Indexer outcome — should report "success" once the indexer reaches RPC.
#    (Auth-protected; see RUNBOOK.md for the auth header.)
curl -s -H "Authorization: Bearer $ADMIN_API_KEY" \
  https://your-backend.onrender.com/api/indexer/monitoring | jq '{outcome, detail, state: .state.rpcConfigured}'
# Expected: outcome "success" (0) and state.rpcConfigured true.

# 2. On-chain stream count is readable — proves the configured CONTRACT_ID and
#    RPC endpoint actually answer queries for your contract on the target network.
curl -s https://your-backend.onrender.com/api/stats | jq '.data.onChainStreamCount'
# Expected: a number (0 is fine on a fresh deployment), NOT null.
```

If `/api/indexer/monitoring` reports `outcome: "blocked"` with a detail telling you to set the RPC URL and contract ID, jump to [Deployment Failure Recovery](#5-deployment-failure-recovery).

---

## 5. Deployment Failure Recovery

This section defines how to detect and recover from the most common deployment-configuration failure: **missing or inconsistent `CONTRACT_ID` / RPC credentials**, including a wrong testnet/mainnet selection. The rule for every step: **retry only what a restart can fix; treat configuration errors as stop-and-fix.**

### Detection: what the failure looks like

| Signal | Where | Meaning |
|---|---|---|
| `❌ Soroban configuration incomplete... required for on-chain operations: CONTRACT_ID and SERVER_PRIVATE_KEY` | startup logs, process exits with code 1 | One or both credentials are missing. |
| `CONTRACT_ID validation failed` / `SERVER_PRIVATE_KEY validation failed` | startup logs, exit 1 | Present but wrong format (must be 56 chars starting `C` / `S`). |
| `CONTRACT_ID not set, event indexer will not start` | startup logs (warning, server keeps running) | Soroban disabled or contract ID absent — API works, chain features don't. |
| `network configuration mismatch` | startup logs, exit 1 | `STELLAR_NETWORK` disagrees with `RPC_URL` or `NETWORK_PASSPHRASE` (e.g., mainnet selected with a testnet RPC). |
| `/api/indexer/monitoring` → `outcome: "blocked"`, `state.rpcConfigured: false` | monitoring endpoint | Running without a configured contract/RPC while work is outstanding. |
| Docker Compose preflight: `backend Soroban configuration is incomplete` (exit 2, nothing started) | `scripts/compose-up.sh` output | Caught **before** containers start. |

### Recovery procedure

```text
1. STOP — read the exact message in the logs. Identify which variable is
   missing, malformed, or on the wrong network.

2. FIX THE ENVIRONMENT (one variable at a time):
   - No contract yet?          deploy one (Section 1), or set SOROBAN_DISABLED=true
                               for a local/API-only run (never in production).
   - CONTRACT_ID wrong format? it must be 56 chars starting with C — copy it
                               from contracts/contract_id.txt of the deploy run.
   - Wrong network?            align STELLAR_NETWORK, RPC_URL and
                               NETWORK_PASSPHRASE to the network the contract
                               was ACTUALLY deployed to (table in Section 1).
   - RPC unreachable?          verify RPC_URL answers: curl -s $RPC_URL -X POST
                               -H 'Content-Type: application/json' \
                               -d '{"jsonrpc":"2.0","id":1,"method":"getLatestLedger"}'

3. REDEPLOY ONCE — apply the env change and trigger a new deploy
   (Render: Manual Deploy → see "Redeploying After Config Changes" below).

4. VERIFY — run the health checks in Section 4, including the network
   connectivity check (`/api/indexer/monitoring` → outcome "success").

→ VERIFIED HEALTHY: done. Record what was misconfigured.
→ STILL FAILING after one fix-and-redeploy cycle: ROLL BACK (step 5).
```

### Safe retry boundaries

- **Retry (safe)**: cold-start timeouts, transient RPC `429`/`503`/network errors, and a single restart of an unhealthy instance. The indexer's circuit breaker already automates this: 5 consecutive poll failures open the circuit, a half-open probe auto-recovers — **do not restart in a loop while the circuit is OPEN**.
- **Never retry**: `exit 1` at startup (environment validation), `exit 2` from `scripts/compose-up.sh` preflight (nothing was started), or the same failure after one fix-and-redeploy cycle. These are configuration errors; restarting only masks them. A restart can only fix a transient runtime condition — it cannot create a missing credential.
- **Rollback trigger**: the service is unhealthy after one config fix + redeploy, or `/api/indexer/monitoring` stays `blocked` for more than 15 minutes after a deploy that was expected to configure it.

### Rollback step

1. **Render**: rollback the deploy — *Deploys* → select the last healthy deploy → **Rollback**.
   *(No Render rollback available? Redeploy the last working commit.)*
2. **Docker Compose**: re-run the last working configuration:
   ```bash
   git stash                     # or checkout the last good .env values
   docker compose down           # NEVER use -v: it deletes the SQLite volume
   ./scripts/compose-up.sh
   ```
3. **Data safety**: both paths preserve the SQLite database (Render: persistent disk; Compose: named volume). Only deleting the disk/volume destroys data — don't.
4. **After rolling back**, file the misconfiguration (which variable, which network) before retrying the upgrade.

### Escape hatch (explicit, temporary)

If you need the API up **without chain features** while sorting out credentials, set `SOROBAN_DISABLED=true`: the server starts, all REST endpoints work, but the indexer will not start and on-chain operations are unavailable. The startup log will say so (`Soroban disabled` / `CONTRACT_ID not set, event indexer will not start`). This is a **local-development mode — never enable it in production**.

---

## 6. Docker Deployment

For a quick production-like setup using Docker Compose.

### Production Setup
1. Copy `backend/.env.example` to `backend/.env` and fill in the required values.
2. Run the following command from the root directory:
   ```bash
   docker-compose up -d --build
   ```

### Overriding for Production
Create a `docker-compose.prod.yml` if you need specific production overrides (e.g., removing dev-only tools):
```yaml
version: "3.9"
services:
  backend:
    build:
      context: ./backend
      dockerfile: dockerfile
    command: ["npm", "start"] # Assuming 'start' runs compiled JS
  frontend:
    build:
      context: ./frontend
      dockerfile: dockerfile
    command: ["npm", "run", "preview", "--", "--host"]
```

---

## 7. Troubleshooting

### "Contract ID not set" in Backend Logs
Ensure the `CONTRACT_ID` environment variable is correctly set in your deployment platform. The indexer will not start without it. Follow the detection and recovery steps in [Deployment Failure Recovery](#5-deployment-failure-recovery).

### Webhook Delivery Failures
Check the `webhook_dead_letters` table in the database. Ensure `WEBHOOK_DESTINATION_URL` is accessible from the backend server. Refer to the [Runbook](RUNBOOK.md) for re-queueing instructions.

### CORS Errors in Frontend
Ensure the backend `ALLOWED_ORIGINS` environment variable includes your frontend domain. If you see opaque CORS errors, also check that no protocol mismatch exists (e.g., `http` vs `https`).

### SQLite Database Locked
This can happen if multiple processes try to write to the SQLite file. In production, ensure only one instance of the backend is running at a time. WAL mode (already enabled in `db.ts`) significantly reduces locking but does not eliminate it with multiple concurrent writers.

### Cold Start Delays (Render Free Tier)
Render's free tier spins down a web service after 15 minutes of inactivity. The first request after a spin-down can take **30–60 seconds** to respond while the service starts up.

Symptoms:
- The health check or first API call hangs or times out
- Logs show the service starting fresh

Mitigations:
- **Accepted**: The delay is normal for free tier. Just wait and retry.
- **Paid**: Upgrade to a paid Render plan to enable "Prevent Cold Starts" (keeps the service always awake).
- **Monitoring**: Set up a cron job (e.g., GitHub Actions or cron-job.org) to ping `/api/health` every 10 minutes.

```bash
# Ping health every 10 minutes to prevent spin-down (cron job)
curl -s https://your-backend.onrender.com/api/health > /dev/null
```

### SQLite WAL File Issues on Persistent Disk

SQLite's WAL mode creates two companion files alongside the database:
- `streams.db-wal` — write-ahead log
- `streams.db-shm` — shared memory file

These files are **automatically managed** by SQLite. They live on the persistent disk alongside the main `.db` file.

Common issues:
- **Missing `-wal` or `-shm` files after redeploy**: If you destroyed and re-created the persistent disk, the files are recreated automatically. As long as `streams.db` is intact, your data is safe.
- **Accidental deletion of WAL files while app is running**: This can corrupt the database. Always stop the service before manipulating database files.
- **Backup strategy**: Periodically copy the entire directory (including WAL files) for backups:
  ```bash
  # Backup the database directory (run from a maintenance window)
  cp -r /data /data-backup
  ```
  To restore, stop the service, replace the `/data` contents, and restart.

### Common Misconfigurations Checklist

| Symptom | Likely Cause | Fix |
|---|---|---|
| Backend starts but `/api/streams` returns empty always | `DB_PATH` points to ephemeral storage; data lost on restart | Set `DB_PATH` to the persistent disk mount path (e.g., `/data/streams.db`) |
| `Indexer not starting` in logs | `CONTRACT_ID` not set or invalid | Verify `CONTRACT_ID` matches the deployed contract |
| Startup exit 1 with `network configuration mismatch` | `STELLAR_NETWORK` disagrees with `RPC_URL` or `NETWORK_PASSPHRASE` | Align all three with the network the contract was deployed to (table in [Section 1](#1-stellar-smart-contract-deployment)) |
| Frontend loads but API calls fail with 404 | `VITE_API_URL` points to the wrong URL | Ensure it includes the full backend URL with `/api` suffix |
| CORS errors in browser console | `ALLOWED_ORIGINS` missing or doesn't include the frontend URL | Set `ALLOWED_ORIGINS` to your Vercel URL |
| `ERR_MODULE_NOT_FOUND` or `better-sqlite3` errors | Native module mismatch — Node.js version differs between dev and Render | Ensure the Node.js version in Render settings matches your dev environment (20.x) |
| Webhook deliveries stuck | `WEBHOOK_DESTINATION_URL` unreachable from Render's network | Verify the destination is publicly accessible and not behind a firewall |
| Database corruption after crash | SQLite wasn't properly closed | WAL mode is crash-safe in most cases. Use `PRAGMA integrity_check` to verify |
| Backend crashes on startup with segfault | `better-sqlite3` compiled for wrong architecture | Rebuild native modules by setting `npm rebuild better-sqlite3` in the build command |

### Checking Backend Logs on Render

1. Go to your Render Web Service dashboard.
2. Click **Logs** in the sidebar.
3. Look for startup messages:
   - ✅ `Server started on port 3001` — app is running
   - ✅ `Database initialized` — SQLite connected
   - ✅ `Indexer started` — Stellar indexer is polling
   - ❌ Any error stack traces — indicates misconfiguration

### Redeploying After Config Changes

After changing environment variables in Render, you **must** manually trigger a deploy:

1. In your Render Web Service dashboard, go to **Manual Deploy**.
2. Click **Deploy latest commit** (or **Clear build cache & deploy** if you suspect caching issues).
3. Wait for the build and deploy to complete (check Logs tab).

On Vercel, environment variable changes trigger an automatic redeploy. If not, use **Redeploy** from the Vercel dashboard.
