# Frequently Asked Questions (FAQ)

This document addresses common questions and issues encountered by users, contributors, and developers working on StellarStream.

## Table of Contents

**General**
1. [What is StellarStream?](#what-is-stellarstream)
2. [What assets can I stream?](#what-assets-can-i-stream)
3. [Are fees charged on streams?](#are-fees-charged-on-streams)
4. [Is StellarStream production-ready?](#is-stellarstream-production-ready)

**For Senders**
5. [How do I create a stream?](#how-do-i-create-a-stream)
6. [Can I cancel a stream after creating it?](#can-i-cancel-a-stream-after-creating-it)
7. [What happens to unvested funds if I cancel a stream?](#what-happens-to-unvested-funds-if-i-cancel-a-stream)
8. [Can I schedule a stream to start in the future?](#can-i-schedule-a-stream-to-start-in-the-future)
9. [What is a cliff period and how do I use it?](#what-is-a-cliff-period-and-how-do-i-use-it)
10. [How do I get testnet XLM to fund a stream?](#how-do-i-get-testnet-xlm-to-fund-a-stream)

**For Recipients**
11. [How do I claim funds from a stream?](#how-do-i-claim-funds-from-a-stream)
12. [How much of a stream can I claim right now?](#how-much-of-a-stream-can-i-claim-right-now)
13. [Can I claim partial amounts instead of the full claimable balance?](#can-i-claim-partial-amounts-instead-of-the-full-claimable-balance)
14. [Why does my claimable amount show 0 even though the stream is active?](#why-does-my-claimable-amount-show-0-even-though-the-stream-is-active)
15. [How do I set up Freighter to receive a stream?](#how-do-i-set-up-freighter-to-receive-a-stream)

**Technical**
16. [How does the vesting math work?](#how-does-the-vesting-math-work)
17. [What are the possible stream statuses?](#what-are-the-possible-stream-statuses)
18. [How does the event indexer stay in sync with the chain?](#how-does-the-event-indexer-stay-in-sync-with-the-chain)
19. [How do I receive webhook notifications for stream events?](#how-do-i-receive-webhook-notifications-for-stream-events)
20. [How do I verify a webhook signature?](#how-do-i-verify-a-webhook-signature)
21. [How do I run the full project locally?](#how-do-i-run-the-full-project-locally)
22. [How do I run tests?](#how-do-i-run-tests)
23. [How do I update contract bindings?](#how-do-i-update-contract-bindings)
24. [How do I change the allowed assets?](#how-do-i-change-the-allowed-assets)
25. [How do I generate a JWT secret?](#how-do-i-generate-a-jwt-secret)

**Troubleshooting**
26. [Why is my stream not updating in the dashboard?](#why-is-my-stream-not-updating-in-the-dashboard)
27. [Why is my claim transaction failing?](#why-is-my-claim-transaction-failing)
28. [Why is the indexer lagging behind the chain?](#why-is-the-indexer-lagging-behind-the-chain)
29. [Why is the indexer circuit breaker open?](#why-is-the-indexer-circuit-breaker-open)
30. [Why aren't my webhooks arriving?](#why-arent-my-webhooks-arriving)
31. [How do I debug WebSocket/live-update issues?](#how-do-i-debug-websocketlive-update-issues)
32. [How do I reset the database?](#how-do-i-reset-the-database)

---

## General

### What is StellarStream?
StellarStream is a payment-streaming platform for the Stellar ecosystem. A sender allocates a total amount of an asset over a fixed duration, and the recipient continuously "vests" (accrues) that value second by second instead of receiving a single lump-sum payment. It's made up of a React dashboard, a Node.js/Express API, a SQLite-backed event indexer, and a Soroban smart contract that models stream state on-chain. See the [README](README.md) for full architecture details, and [`docs/USE_CASES.md`](docs/USE_CASES.md) for real-world scenarios like payroll, contractor vesting, and grant streaming.

### What assets can I stream?
The allowed asset codes are controlled by the `ALLOWED_ASSETS` environment variable on the backend (default: `USDC,XLM`). Administrators can add more assets (e.g. `EURC`) by editing this comma-separated list — see [How do I change the allowed assets?](#how-do-i-change-the-allowed-assets). You can check the currently active allowlist at runtime via `GET /api/assets`.

### Are fees charged on streams?
StellarStream itself does not levy a protocol fee on stream creation, claims, or cancellation in the current MVP. You still pay standard Stellar network transaction fees (typically a small fraction of a lumen) for any on-chain operation submitted through your wallet, since every `create_stream`, `claim`, and `cancel` call is a Soroban contract invocation. Budget for these network fees separately from the streamed asset amount.

### Is StellarStream production-ready?
Not yet — treat it as an MVP. Per the [README's Known Limitations](README.md#10-known-limitations), the Soroban contract is not yet fully wired to the backend's execution path for token transfers, there is no authentication layer on write endpoints by default, and wallet-signed transaction flows are still being built out in the UI. See [SECURITY.md](SECURITY.md) for the current self-audit checklist and how to report vulnerabilities before relying on this for real funds.

## For Senders

### How do I create a stream?
Send a `POST /api/streams` request (or use the dashboard's "Create Stream" form) with `sender`, `recipient`, `assetCode`, `totalAmount`, and `durationSeconds`. The recipient's Stellar account ID must be a valid 56-character `G...` address, the asset code must be 2–12 characters, the total amount must be positive, and the duration must be at least 60 seconds. You can optionally pass `startAt` (a future Unix timestamp) to schedule the stream, and `cliffSeconds` to delay initial vesting. See [`docs/USE_CASES.md`](docs/USE_CASES.md) for full worked examples, including payroll and contractor-vesting parameter sets.

### Can I cancel a stream after creating it?
Yes. Call `POST /api/streams/:id/cancel` (or use the "Cancel" action in the dashboard). Cancellation is only meaningful for streams that haven't fully completed — once a stream reaches its end time, all funds are already vested to the recipient and there's nothing left to cancel.

### What happens to unvested funds if I cancel a stream?
When you cancel, the amount already vested up to that moment remains claimable by the recipient, and the remaining (unvested) balance is returned to the sender. The vested/remaining split at the moment of cancellation is computed using the same linear vesting formula used everywhere else — see [How does the vesting math work?](#how-does-the-vesting-math-work).

### Can I schedule a stream to start in the future?
Yes. Pass an optional `startAt` field (Unix seconds) when creating a stream. Until that time is reached, the stream's status is `scheduled` and nothing is claimable; once `startAt` passes, it automatically becomes `active` and vesting begins.

### What is a cliff period and how do I use it?
A cliff (`cliffSeconds`) delays the start of claimable vesting until an initial milestone has passed, even though the stream is technically active. This is useful for contractor or grant streams where you want to confirm early deliverables before any funds become claimable — see the "Contractor Vesting (Milestone & Cliff Streaming)" use case in [`docs/USE_CASES.md`](docs/USE_CASES.md#2-contractor-vesting-milestone--cliff-streaming) for a complete example.

### How do I get testnet XLM to fund a stream?
Use the **Friendbot** service to fund a testnet account:
- **Via URL:** Open `https://friendbot.stellar.org/?addr=YOUR_PUBLIC_KEY` in your browser.
- **Via CLI:** `curl "https://friendbot.stellar.org/?addr=YOUR_PUBLIC_KEY"`
- **Via Laboratory:** Use the [Stellar Laboratory Account Creator](https://laboratory.stellar.org/#account-creator?network=testnet).

## For Recipients

### How do I claim funds from a stream?
In the dashboard, open the stream and click "Claim." Under the hood, the frontend fetches the current claimable amount from `GET /api/streams/:id`, then asks your connected Freighter wallet to sign a `claim(streamId, amount)` transaction, which is submitted to the Soroban contract. Once confirmed on-chain, the indexer picks up the `Claimed` event and updates the stream's history.

### How much of a stream can I claim right now?
Claimable balance grows continuously and linearly between the stream's start and end times (see [How does the vesting math work?](#how-does-the-vesting-math-work)). You can check the live claimable amount via `GET /api/streams/:id`, or read it directly from the contract using `claimable(stream_id, at_time)`.

### Can I claim partial amounts instead of the full claimable balance?
Yes. The contract's `claim(stream_id, recipient, amount)` method accepts a specific amount up to the current claimable balance — you are not required to withdraw the full vested amount in a single transaction. You can claim smaller amounts more frequently if you prefer.

### Why does my claimable amount show 0 even though the stream is active?
A few common causes: the stream may still be inside its `cliffSeconds` window (nothing vests until the cliff passes); the stream's `startAt` may be in the future, making its status `scheduled` rather than `active`; or you've already claimed the full amount currently vested and need to wait for more time to elapse. If none of those apply, check whether the indexer is lagging — see [Why is the indexer lagging behind the chain?](#why-is-the-indexer-lagging-behind-the-chain).

### How do I set up Freighter to receive a stream?
1. Install the extension from [freighter.app](https://www.freighter.app/).
2. Open Freighter settings (gear icon) → **Network Settings**.
3. Ensure the network matches the one the stream was created on (e.g. **Test Net** for testnet streams).
4. Create or import an account and share your `G...` public key with the sender so it can be used as the `recipient` address.

## Technical

### How does the vesting math work?
For a stream with total amount $A_{total}$, start time $t_{start}$, and duration $d$ (seconds), the end time is $t_{end} = t_{start} + d$. At any current time $t$, the elapsed time, vesting ratio, vested amount, and remaining amount are:

$$\Delta t = \max(0, \min(t - t_{start}, d))$$

$$R = \Delta t / d$$

$$A_{vested} = A_{total} \times R$$

$$A_{remaining} = A_{total} - A_{vested}$$

See the full derivation, including cliff handling, in [`docs/STREAM_MATH.md`](docs/STREAM_MATH.md) and the [README's Stream Math Model](README.md#3-stream-math-model).

### What are the possible stream statuses?
- `scheduled` — `t < t_start` (stream created but not yet started)
- `active` — `t_start <= t < t_end` (vesting in progress)
- `completed` — `t >= t_end` (fully vested)
- `canceled` — explicitly terminated early by the sender

### How does the event indexer stay in sync with the chain?
A backend worker polls the Stellar RPC node on an interval (`INDEXER_POLL_INTERVAL_MS`, default 10 seconds) for new `StreamCreated`, `Claimed`, and `Canceled` events, then writes stream and event records into SQLite. Progress is tracked via a cursor (`indexer_cursor` table) so restarts resume where they left off. See the Event Flow diagrams in the [README](README.md#event-flow) and the [`STREAM_EVENTS_IMPLEMENTATION.md`](STREAM_EVENTS_IMPLEMENTATION.md) doc for details.

### How do I receive webhook notifications for stream events?
Set `WEBHOOK_DESTINATION_URL` in `backend/.env` to your endpoint. The backend will POST a JSON payload for each `created`/`claimed`/`canceled` event, retrying on failure with fixed backoff delays (5s, 15s, 60s, 300s, 900s) before moving the delivery to a dead-letter queue. See [RUNBOOK.md](RUNBOOK.md#requeue-dead-letter-webhooks) for how to inspect and requeue dead-lettered webhooks.

### How do I verify a webhook signature?
Configure `WEBHOOK_SIGNING_SECRET` alongside `WEBHOOK_DESTINATION_URL` — without it, webhooks are delivered unsigned and a warning is logged at startup. When set, every webhook includes an `X-StellarStream-Signature: sha256=<hmac>` header. Compute an HMAC-SHA256 digest of the raw request body using your signing secret and compare it to the header value using a constant-time comparison. Node.js and Python reference implementations are in the [README's Webhook Signing & Verification section](README.md#webhook-signing--verification).

### How do I run the full project locally?
The easiest way is to use the root-level scripts:
```bash
# Install all dependencies
npm run install:all

# Start frontend and backend in development mode
npm run dev:backend
npm run dev:frontend
```
See the [README.md](README.md#6-run-locally) for Docker Compose and manual setup alternatives.

### How do I run tests?
- **Backend:** `cd backend && npm test`. See [TESTING.md](backend/TESTING.md) for integration test details.
- **Contracts:** `cd contracts && cargo test`.
- **Frontend:** `cd frontend && npm test`.

### How do I update contract bindings?
If you've modified the Soroban contract and want to update the TypeScript clients:
```bash
./scripts/generate-contract-bindings.sh
```
Refer to [`docs/CONTRACT_BINDINGS.md`](docs/CONTRACT_BINDINGS.md) for requirements. Remember to regenerate and commit bindings after every contract redeploy — see [README section 7](README.md#7-deploy-contract).

### How do I change the allowed assets?
The assets allowed for streaming are configured in the backend environment:
1. Edit `ALLOWED_ASSETS` in `backend/.env` (comma-separated list, e.g., `USDC,XLM,EURC`).
2. Restart the backend server.
3. The frontend and API validation will automatically pick up the new list.

### How do I generate a JWT secret?
The `JWT_SECRET` in `backend/.env` should be a strong, random string. You can generate one using:
```bash
openssl rand -hex 32
```
Add the output to your `backend/.env` file. See [RUNBOOK.md](RUNBOOK.md#rotate-jwt-secret) for the full rotation procedure, including its effect on active sessions.

## Troubleshooting

### Why is my stream not updating in the dashboard?
The frontend polls `GET /api/streams` every 5 seconds by default, so brief staleness is expected. If a stream still looks frozen after a refresh:
1. Confirm the stream's on-chain transaction actually confirmed (check the transaction hash in a [Stellar Explorer](https://stellar.expert/)).
2. Check whether the indexer is lagging — see [Why is the indexer lagging behind the chain?](#why-is-the-indexer-lagging-behind-the-chain).
3. Check `GET /api/streams/:id/history` directly to see whether the event was recorded on the backend at all.

### Why is my claim transaction failing?
Common causes, roughly in order of likelihood:
- **Nothing claimable yet:** you're inside a cliff window, the stream hasn't started (`scheduled` status), or you've already claimed everything currently vested.
- **Amount exceeds claimable balance:** the contract's `claim` call validates the requested amount against the on-chain claimable balance at call time; requesting more than that will revert.
- **Wrong recipient:** `claim` verifies the caller matches the stream's `recipient` address — claims from any other account will be rejected.
- **Stale UI amount:** if the claimable amount shown was computed slightly earlier, re-fetch `GET /api/streams/:id` immediately before submitting to get the latest figure.

### Why is the indexer lagging behind the chain?
Symptoms include stream statuses looking stale (e.g. a completed stream still showing "active") and `indexer_lag_seconds` exceeding its alert threshold. Check the indexer cursor against the latest Stellar ledger, verify RPC connectivity, and consider lowering `INDEXER_POLL_INTERVAL_MS`. Full diagnosis and remediation steps (including a manual `INDEXER_START_LEDGER` reconcile) are in [RUNBOOK.md](RUNBOOK.md#indexer-falls-behind).

### Why is the indexer circuit breaker open?
The indexer circuit breaker opens when it encounters 5 consecutive failures while communicating with the Stellar RPC node. This is a safety mechanism to prevent flooding a failing node with requests.
- **Status:** Check logs for `[Circuit Breaker] State Transition`.
- **Recovery:** The circuit stays `OPEN` for 60 seconds (default) before transitioning to `HALF_OPEN` to test a single request. If it succeeds, it returns to `CLOSED`.
- **Configuration:** See `CIRCUIT_BREAKER_TIMEOUT_MS` in [indexer.ts](backend/src/services/indexer.ts).

### Why aren't my webhooks arriving?
1. Confirm `WEBHOOK_DESTINATION_URL` is set and reachable from the backend (`curl` it directly).
2. Check for entries in the dead-letter queue — deliveries that exhaust all retries land there instead of being dropped silently:
   ```bash
   sqlite3 backend/data/streams.db "SELECT COUNT(*) FROM webhook_dead_letters;"
   ```
3. Once the receiver is healthy again, requeue failed deliveries via the admin API. Full diagnosis and requeue steps are in [RUNBOOK.md](RUNBOOK.md#webhook-dead-letter-spike).

### How do I debug WebSocket/live-update issues?
The frontend uses polling (and WebSockets in newer flows) for near-real-time updates. If updates aren't appearing:
1. Open Browser DevTools → **Network** tab.
2. Filter by **WS** (WebSockets).
3. Check if the connection to `ws://localhost:3001` is successful.
4. Look for messages in the **Frames** or **Messages** sub-tab.
5. Check [useWebSocket.ts](frontend/src/hooks/useWebSocket.ts) for reconnection logic.

### How do I reset the database?
If you need a fresh start with the backend data:
1. Stop the backend server.
2. Delete the SQLite database file:
   ```bash
   rm backend/data/streams.db
   ```
3. Restart the backend. The database and tables will be automatically recreated by the migration layer in [db.ts](backend/src/services/db.ts).

For a production instance, follow the safer procedure (with prerequisites and expected output) in [RUNBOOK.md](RUNBOOK.md#reset-sqlite-database) instead.
