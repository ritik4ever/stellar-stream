# StellarStream

StellarStream is a basic payment-streaming MVP for the Stellar ecosystem.

It includes:
- A React dashboard to create and monitor streams
- A Node.js/Express API for stream lifecycle operations
- A Soroban smart contract scaffold for on-chain stream logic
- A backlog folder with implementation task drafts

This repository is intentionally lightweight and easy to extend.

## 1) What The Project Does

StellarStream models a payment stream where a sender allocates a total amount over a fixed duration.  
As time passes, the recipient "vests" value continuously.

Current MVP behavior:
- Create stream
- List streams with live progress
- Cancel stream
- Show computed metrics (active/completed/vested)

## 2) Current Architecture

Frontend (`frontend`, port `3000`)
- React + Vite app
- Uses `/api` proxy to call backend
- Polls stream list every 5 seconds

Backend (`backend`, port `3001`)
- Express REST API
- In-memory stream storage (`Map`)
- Computes progress in real time from timestamps

Contract (`contracts`)
- Soroban contract scaffold in Rust
- Supports `create_stream`, `claimable`, `claim`, and `cancel`
- Not yet integrated with backend runtime in this MVP

## 3) Stream Math Model

For each stream:
- `totalAmount`
- `startAt`
- `durationSeconds`
- `end = startAt + durationSeconds`

At time `t`:
- `elapsed = clamp(t - startAt, 0, durationSeconds)`
- `ratio = elapsed / durationSeconds`
- `vested = totalAmount * ratio`
- `remaining = totalAmount - vested`

Status rules:
- `scheduled` when `t < startAt`
- `active` when `startAt <= t < end`
- `completed` when `t >= end`
- `canceled` when stream was canceled

## 4) API Reference

Base URL:
- Local: `http://localhost:3001`
- Frontend proxy: `/api`

### `GET /api/health`
Purpose:
- Service health check

Response:
- `service`, `status`, `timestamp`

### `GET /api/streams`
Purpose:
- List all streams sorted by newest first

Response:
- `data: Stream[]` (includes computed `progress`)

### `GET /api/streams/:id`
Purpose:
- Fetch single stream by ID

Response:
- `data: Stream`

Error:
- `404` if stream does not exist

### `POST /api/streams`
Purpose:
- Create a new stream

Request JSON:
- `sender: string`
- `recipient: string`
- `assetCode: string`
- `totalAmount: number`
- `durationSeconds: number` (minimum 60)
- `startAt?: number` (unix seconds)

Validation:
- Sender/recipient must be non-trivial strings
- Asset length must be 2..12
- Amount must be positive
- Duration must be at least 60 seconds

Response:
- `201` with `data: Stream`

### `POST /api/streams/:id/cancel`
Purpose:
- Cancel an existing stream

Response:
- `data: Stream` with canceled state

Error:
- `404` if stream does not exist

### `GET /api/open-issues`
Purpose:
- Returns implementation backlog items shown in UI

Response:
- `data: OpenIssue[]`

## 5) Smart Contract (Soroban) Behavior

Contract file:
- `contracts/src/lib.rs`

Data:
- `NextStreamId`
- `Stream(stream_id) -> Stream`

Implemented methods:
- `create_stream(...) -> u64`
- `get_stream(stream_id) -> Stream`
- `claimable(stream_id, at_time) -> i128`
- `claim(stream_id, recipient, amount) -> i128`
- `cancel(stream_id, sender)`

Important note:
- `claim` currently updates accounting only.
- Token transfer wiring is planned as next implementation step.

## 6) Run Locally

Prerequisites:
- Node.js 18+
- npm 9+
- Optional for contract work: Rust + Soroban toolchain

From repo root:

```bash
npm run install:all
npm run dev:backend
npm run dev:frontend
```

Manual alternative:

```bash
cd backend && npm install && npm run dev
cd frontend && npm install && npm run dev
```

Open:
- Frontend: `http://localhost:3000`
- Backend: `http://localhost:3001`

Build:

```bash
npm run build
```

## 7) Deploy Contract

Deploy the Soroban contract to Stellar testnet.

### Prerequisites

- [soroban-cli](https://soroban.stellar.org/docs/getting-started/setup#install-the-soroban-cli) installed
- Rust toolchain with `wasm32-unknown-unknown` target
- Stellar testnet account with secret key

### Deployment

Set the `SECRET_KEY` environment variable and run:

```bash
SECRET_KEY="S..." npm run deploy:contract
```

Or use the script directly:

```bash
SECRET_KEY="S..." ./scripts/deploy.sh
```

The script will:
1. Build the contract
2. Deploy to Stellar testnet
3. Output the contract ID
4. Save the contract ID to `contracts/contract_id.txt`

### Environment Variables for Deployment

**Required:**
- `SECRET_KEY` - Stellar account secret key for deployment (must have testnet XLM for fees)

**Optional:**
- `NETWORK_PASSPHRASE` - Network passphrase (defaults to testnet: `"Test SDF Network ; September 2015"`)
- `RPC_URL` - RPC endpoint URL (defaults to `https://soroban-testnet.stellar.org:443`)

### After Deployment

1. Copy the contract ID from the output or `contracts/contract_id.txt`
2. Set `CONTRACT_ID` in your backend `.env` file
3. Ensure `SERVER_PRIVATE_KEY` is set in your backend `.env` file
4. Restart your backend service

## 8) Environment And Config

Backend:
- `PORT` (optional, defaults to `3001`)
- `CONTRACT_ID` (required for on-chain operations) - Contract ID from deployment
- `SERVER_PRIVATE_KEY` (required for on-chain operations) - Stellar account secret key
- `RPC_URL` (optional, defaults to `https://soroban-testnet.stellar.org:443`) - Soroban RPC endpoint
- `NETWORK_PASSPHRASE` (optional, defaults to testnet) - Network passphrase
- `ALLOWED_ASSETS` (optional, defaults to `USDC,XLM`) - Comma-separated list of allowed asset codes

Frontend:
- `VITE_API_URL` (optional, defaults to `/api`)

Ignored files:
- `node_modules`, `dist`, logs, local env files, Soroban build outputs

## 9) Project File Map

Root:
- `.gitignore`: ignore rules for Node/Rust/local files.
- `package.json`: root helper scripts (install/build/dev delegates).
- `README.md`: project documentation.

GitHub templates:
- `.github/ISSUE_TEMPLATE/config.yml`: issue template behavior.
- `.github/ISSUE_TEMPLATE/project-task.md`: reusable issue template file.

Backend:
- `backend/package.json`: backend dependencies and scripts.
- `backend/tsconfig.json`: backend TypeScript compiler config.
- `backend/src/index.ts`: API server, route handlers, request validation.
- `backend/src/services/streamStore.ts`: in-memory stream store + progress math.
- `backend/src/services/openIssues.ts`: backlog entries returned by API.

Frontend:
- `frontend/index.html`: Vite HTML entry.
- `frontend/package.json`: frontend dependencies and scripts.
- `frontend/postcss.config.js`: PostCSS plugin config.
- `frontend/tailwind.config.js`: Tailwind config (kept for styling extension).
- `frontend/tsconfig.json`: frontend TypeScript config.
- `frontend/tsconfig.node.json`: TS config for Vite/node-side files.
- `frontend/vite.config.ts`: dev server config + backend API proxy.
- `frontend/src/main.tsx`: React app bootstrap.
- `frontend/src/App.tsx`: top-level layout, polling, metrics, handlers.
- `frontend/src/index.css`: app styles.
- `frontend/src/services/api.ts`: typed API client functions.
- `frontend/src/types/stream.ts`: shared frontend data types.
- `frontend/src/components/CreateStreamForm.tsx`: stream creation form.
- `frontend/src/components/StreamsTable.tsx`: stream list and cancel actions.
- `frontend/src/components/IssueBacklog.tsx`: backlog panel renderer.

Contract:
- `contracts/Cargo.toml`: Rust crate and Soroban dependency config.
- `contracts/src/lib.rs`: Soroban contract implementation scaffold.



## 10) Known Limitations

- Backend storage is in memory (not persistent).
- Contract is not connected to backend execution path yet.
- Wallet sign/transaction flow is not active yet in UI.
- No authentication layer on write endpoints.
- Test coverage and CI can be expanded.

## 11) Suggested Next Steps

- Move stream source of truth from memory to Soroban state.
- Add wallet-authenticated transaction signing flow.
- Add contract tests and backend integration tests.
- Add persistent event/history storage for analytics.


