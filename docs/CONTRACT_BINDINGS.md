# Contract Bindings Workflow

This document explains how to generate, version, and consume TypeScript bindings
for the StellarStream Soroban contract. Follow this guide whenever the contract
ABI changes or you are setting up the frontend for the first time.

---

## Overview

`soroban contract bindings typescript` reads a deployed contract's ABI from the
network and generates a fully-typed TypeScript client. StellarStream keeps that
output in `frontend/src/contracts/generated/` — a folder that is **gitignored**
and must be regenerated locally or in CI before the frontend can call the contract
directly.

```
contracts/src/lib.rs          ← Rust source of truth
        │  build + deploy
        ▼
  Stellar Testnet              ← CONTRACT_ID lives here
        │  soroban contract bindings typescript
        ▼
frontend/src/contracts/generated/   ← gitignored, regenerate as needed
        │  import
        ▼
frontend/src/services/contractClient.ts  ← thin wrapper used by the app
```

---

## Prerequisites

| Tool | Version | Notes |
|---|---|---|
| `soroban-cli` | latest | `cargo install --locked soroban-cli` |
| Rust + `wasm32-unknown-unknown` | stable | needed to build the contract |
| Node.js | 18+ | for the frontend |
| A deployed contract | — | run `npm run deploy:contract` first |

---

## Step 1 — Deploy the contract (if not already done)

```bash
SECRET_KEY="S..." npm run deploy:contract
```

The script saves the contract ID to `contracts/contract_id.txt`.

---

## Step 2 — Generate the bindings

```bash
# Read the saved contract ID and generate
CONTRACT_ID=$(cat contracts/contract_id.txt) npm run gen:bindings

# Or pass it directly
CONTRACT_ID="C..." npm run gen:bindings
```

**What the script does:**

1. Wipes `frontend/src/contracts/generated/` (prevents stale files)
2. Calls `soroban contract bindings typescript` against the deployed contract
3. Writes the generated package into the output directory
4. Prints the next-step instructions

**Optional env overrides:**

| Variable | Default | Purpose |
|---|---|---|
| `RPC_URL` | `https://soroban-testnet.stellar.org:443` | Target RPC endpoint |
| `NETWORK_PASSPHRASE` | `Test SDF Network ; September 2015` | Network passphrase |

---

## Step 3 — What gets generated

After running the command, `frontend/src/contracts/generated/` will contain:

```
generated/
├── index.ts          ← main export: Contract class + all types
├── methods.ts        ← one typed function per contract method
└── types.ts          ← Stream, StreamCreated, StreamClaimed, StreamCanceled structs
```

### Generated types (from `contracts/src/lib.rs`)

| Rust type | TypeScript type | Description |
|---|---|---|
| `Stream` | `Stream` | Full stream record with sender, recipient, token, amounts, times, canceled flag |
| `StreamCreated` | `StreamCreated` | Event emitted on `create_stream` |
| `StreamClaimed` | `StreamClaimed` | Event emitted on `claim` |
| `StreamCanceled` | `StreamCanceled` | Event emitted on `cancel` |

### Generated methods

| Contract method | TypeScript signature | Notes |
|---|---|---|
| `create_stream` | `createStream(sender, recipient, token, totalAmount, startTime, endTime) → u64` | Returns new stream ID |
| `get_stream` | `getStream(streamId) → Stream` | Read-only |
| `get_next_stream_id` | `getNextStreamId() → u64` | Read-only |
| `claimable` | `claimable(streamId, atTime) → i128` | Read-only, returns claimable amount at a given timestamp |
| `claim` | `claim(streamId, recipient, amount) → i128` | Requires recipient auth |
| `cancel` | `cancel(streamId, sender)` | Requires sender auth, refunds unvested amount |

---

## Step 4 — Consuming the bindings in the frontend

Create a thin wrapper at `frontend/src/services/contractClient.ts` so components
never import from `generated/` directly:

```typescript
// frontend/src/services/contractClient.ts
import { Contract } from "../contracts/generated";

const CONTRACT_ID = import.meta.env.VITE_CONTRACT_ID ?? "";
const RPC_URL =
  import.meta.env.VITE_RPC_URL ?? "https://soroban-testnet.stellar.org:443";
const NETWORK_PASSPHRASE =
  import.meta.env.VITE_NETWORK_PASSPHRASE ??
  "Test SDF Network ; September 2015";

export const streamContract = new Contract({
  contractId: CONTRACT_ID,
  rpcUrl: RPC_URL,
  networkPassphrase: NETWORK_PASSPHRASE,
});
```

---

## Step 5 — Frontend integration points

The following locations in `frontend/src/services/api.ts` are where direct
contract calls will replace (or augment) the current REST API calls once
wallet signing is wired up:

### `createStream` — POST /api/streams

```typescript
// CURRENT (REST API via backend)
export async function createStream(payload: CreateStreamPayload): Promise<Stream> {
  const response = await fetch(`${API_BASE}/streams`, { method: "POST", ... });
  ...
}

// FUTURE (direct contract call, requires wallet signer)
// import { streamContract } from "./contractClient";
// const streamId = await streamContract.createStream(
//   sender, recipient, tokenAddress, totalAmount, startTime, endTime
// );
```

### `cancelStream` — POST /api/streams/:id/cancel

```typescript
// CURRENT (REST API via backend)
export async function cancelStream(streamId: string): Promise<Stream> {
  const response = await fetch(`${API_BASE}/streams/${streamId}/cancel`, { method: "POST" });
  ...
}

// FUTURE (direct contract call, requires sender auth)
// await streamContract.cancel(BigInt(streamId), senderAddress);
```

### Claimable amount (no current REST equivalent)

```typescript
// FUTURE — read claimable amount directly from chain (no backend needed)
// import { streamContract } from "./contractClient";
// const claimable = await streamContract.claimable(
//   BigInt(streamId),
//   BigInt(Math.floor(Date.now() / 1000))
// );
```

### `claim` (no current REST equivalent)

```typescript
// FUTURE — recipient claims vested tokens directly from contract
// await streamContract.claim(BigInt(streamId), recipientAddress, amount);
```

---

## Regenerating after a contract change

Any time `contracts/src/lib.rs` changes a method signature or adds/removes a
public method:

1. Rebuild and redeploy: `SECRET_KEY="S..." npm run deploy:contract`
2. Update `CONTRACT_ID` in `backend/.env`
3. Regenerate bindings: `CONTRACT_ID=$(cat contracts/contract_id.txt) npm run gen:bindings`
4. Update `contractClient.ts` if new methods need to be exposed
5. Update `VITE_CONTRACT_ID` in `frontend/.env` if needed

---

## CI / automated regeneration

To regenerate bindings in a CI pipeline, add a step after deployment:

```yaml
- name: Generate contract bindings
  env:
    CONTRACT_ID: ${{ steps.deploy.outputs.contract_id }}
  run: npm run gen:bindings
```

The generated files do not need to be committed they can be regenerated from
the deployed contract ID on every CI run.

---

## Gitignore rules

The following lines should be present in `.gitignore`:

```
# Generated Soroban contract bindings — regenerate with: npm run gen:bindings
frontend/src/contracts/generated/*
!frontend/src/contracts/generated/README.md
```

This keeps the folder tracked so contributors know where to look while
excluding the generated output which changes with every deployment.