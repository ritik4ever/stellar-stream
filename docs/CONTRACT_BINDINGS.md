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

### `create_stream` — Creating a new payment stream

To create a stream, the sender must authorize the transaction. The tokens are transferred from the sender's account to the contract's escrow.

```typescript
import { streamContract } from "./contractClient";

async function handleCreateStream(sender: string, recipient: string, token: string) {
  try {
    const totalAmount = BigInt(1000 * 10**7); // 1000 tokens with 7 decimals
    const startTime = BigInt(Math.floor(Date.now() / 1000));
    const endTime = startTime + BigInt(30 * 24 * 60 * 60); // 30 days
    const cliffSeconds = BigInt(0);

    // Metadata is optional
    const metadata = new Map([
      ["label", "Monthly Salary"],
      ["project", "StellarStream"]
    ]);

    const streamId = await streamContract.createStream({
      sender,
      recipient,
      token,
      total_amount: totalAmount,
      start_time: startTime,
      end_time: endTime,
      cliff_seconds: cliffSeconds,
      metadata
    });

    console.log(`Stream created with ID: ${streamId}`);
  } catch (err) {
    console.error("Failed to create stream:", err);
  }
}
```

### `claim` — Recipient claiming vested tokens

The recipient can claim any amount up to the current `claimable` total. This requires Freighter (or another wallet) to sign for the recipient's `Address`.

```typescript
import { streamContract } from "./contractClient";

async function handleClaim(streamId: bigint, recipient: string, amount: bigint) {
  try {
    // This will trigger a wallet popup for the recipient to authorize
    const claimed = await streamContract.claim({
      stream_id: streamId,
      recipient,
      amount
    });

    console.log(`Successfully claimed ${claimed} tokens`);
  } catch (err) {
    // See "Error Handling" section below for common error codes
    console.error("Claim failed:", err);
  }
}
```

### `get_claimable_batch` — Efficiently fetching multiple balances

Instead of calling `claimable` for every stream in a list, use the batch method.

```typescript
import { streamContract } from "./contractClient";

async function fetchBalances(streamIds: bigint[]) {
  const now = BigInt(Math.floor(Date.now() / 1000));
  
  // Returns a Map<bigint, bigint>
  const balances = await streamContract.getClaimableBatch({
    stream_ids: streamIds,
    at_time: now
  });

  streamIds.forEach(id => {
    console.log(`Stream ${id} balance: ${balances.get(id)}`);
  });
}
```

---

## Error Handling

The Soroban contract will panic with specific messages if validation fails. The TypeScript client captures these as errors.

| Error Message | Cause |
|---|---|
| `total_amount must be positive` | `total_amount` is 0 or negative. |
| `end_time must be greater than start_time` | Invalid time range provided. |
| `insufficient sender balance` | Sender does not have enough tokens to escrow. |
| `recipient mismatch` | The address calling `claim` is not the stream's recipient. |
| `amount exceeds claimable` | Trying to claim more than what has vested. |
| `too many stream ids` | `get_claimable_batch` called with more than 20 IDs. |
| `stream canceled` | Action attempted on a canceled stream. |

### Example error check

```typescript
try {
  await streamContract.claim({ ... });
} catch (err: any) {
  if (err.message.includes("amount exceeds claimable")) {
    // Handle specific business logic error
  }
}
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

## Step-by-Step: Generating Bindings for the First Time

If you've just cloned this repo, `frontend/src/contracts/generated/` won't exist yet — it's gitignored and must be generated locally.

1. **Install the Stellar CLI** (if you don't have it):
```bash
   cargo install --locked stellar-cli
```
   Or see the [official install guide](https://developers.stellar.org/docs/tools/cli/install-cli).

2. **Confirm the contract is deployed** on the network you're targeting (testnet by default for this project) and note its contract ID (starts with `C...`).

3. **Run the project's binding generation script:**
```bash
   npm run gen:bindings
```
   This wraps `stellar contract bindings typescript --network testnet --id <CONTRACT_ID> --output-dir frontend/src/contracts/generated --overwrite` (see the script definition in `package.json` for exact flags).

4. **Verify the output.** After it completes, `frontend/src/contracts/generated/` should contain a typed client package (an `index.ts` or similar barrel file, plus type definitions matching the contract's methods).

5. **Build the frontend** to confirm the generated types compile cleanly:
```bash
   cd frontend
   npm run build
```

If this is your very first time running it, you should end up with fully typed functions for every contract method (e.g. `create_stream`, `claim`, `cancel`) — if you don't see those, see Troubleshooting below.

## Updating Bindings After a Contract Upgrade

Bindings are a point-in-time snapshot of the contract's interface. Whenever the contract is redeployed — even for a minor change — the bindings can silently go stale and reference methods/types that no longer match on-chain reality.

1. **Redeploy or upgrade the contract** and get the new contract ID (or confirm the existing one, if you're upgrading via Soroban's upgrade mechanism rather than a fresh deploy).
2. **Delete the old generated bindings** to avoid stale leftovers mixing with new output:
```bash
   rm -rf frontend/src/contracts/generated
```
3. **Re-run the generation script**, pointing at the current contract ID:
```bash
   npm run gen:bindings
```
4. **Diff the generated output** against what was previously committed/used in code — if a method signature changed (new required argument, renamed field, different return type), TypeScript will surface compile errors in any frontend code calling it. This is expected and is the whole point of typed bindings: fix the call sites, don't suppress the error.
5. **Rebuild and smoke-test** the frontend against the upgraded contract before merging.

> **Tip:** treat "regenerate bindings" as a required step in your contract-deploy checklist, not an optional one — this project doesn't yet automate it in CI (see the README's roadmap), so it's a manual step every contributor must remember.

## Troubleshooting Common Errors

### `Error: contract not found` / binding generation fails immediately
- **Cause:** wrong or mistyped contract ID, or the contract isn't actually deployed on the network you pointed the CLI at.
- **Fix:** double-check the contract ID you're passing matches exactly (Stellar contract IDs are case-sensitive, start with `C`, and are 56 characters). Confirm deployment with:
```bash
  stellar contract info interface --id <CONTRACT_ID> --network testnet
```
  If that also fails, the contract isn't deployed where you think it is.

### `Error: network mismatch` or bindings work but calls fail at runtime
- **Cause:** bindings were generated against one network (e.g. testnet) but your app is configured to call the contract on a different network (e.g. futurenet, or a different testnet contract instance), or the `networkPassphrase` used when instantiating the client doesn't match the network the bindings were generated from.
- **Fix:** ensure the `--network` flag used during generation matches the network your frontend's client configuration points to (check wherever `contractClient.ts` or similar sets up the RPC URL / network passphrase). These three things must agree: generation network, RPC URL at runtime, and network passphrase at runtime.

### Generated file exists but frontend won't compile / "Cannot find module"
- **Cause:** `frontend/src/contracts/generated/` is gitignored — if you skipped Step 1-3 above (first-time generation) after a fresh clone, the import will fail because the folder is empty or missing.
- **Fix:** run `npm run gen:bindings` before running the frontend dev server for the first time on any fresh clone.

### Bindings generated successfully, but calling a method throws at runtime with an unrelated-looking error
- **Cause:** most often this means the bindings are stale relative to a contract that was upgraded since the last generation (see "Updating Bindings After a Contract Upgrade" above), even if the compile step didn't catch it (e.g. an argument order change that TypeScript couldn't detect because the types happened to still align).
- **Fix:** regenerate the bindings fresh and re-test before debugging further.

## Using Bindings in Frontend Code

Once generated, import the typed client from `frontend/src/contracts/generated/` wherever you need to call the contract — this is intended to be consumed from `frontend/src/services/contractClient.ts` per the project's architecture.

```typescript
import { Client, networks } from "../contracts/generated";

const client = new Client({
  contractId: "<CONTRACT_ID>",
  networkPassphrase: networks.testnet.networkPassphrase, // must match generation network
  rpcUrl: "https://soroban-testnet.stellar.org",
  publicKey: userPublicKey, // from connected wallet
});

// Example: calling a contract method with full type-checking and IDE autocomplete
const tx = await client.create_stream({
  sender: senderAddress,
  recipient: recipientAddress,
  amount: streamAmount,
  // ...remaining typed args, exact shape depends on the contract's current interface
});

const result = await tx.signAndSend();
```

Key points for frontend integration:
- The generated client gives you compile-time type safety — if the contract's interface changes and you forget to regenerate, TypeScript will not catch it (stale types still "look" valid), which is why regenerating after every deploy matters (see above).
- Prefer importing from the barrel file (`index.ts`) at the root of the generated folder rather than reaching into individual generated files directly, so future regenerations don't break your imports if internal file structure changes.
- Since `frontend/src/contracts/generated/` is gitignored, CI and new contributors must run `npm run gen:bindings` before the frontend will build — make sure this is documented in your local setup steps (see `README.md`).