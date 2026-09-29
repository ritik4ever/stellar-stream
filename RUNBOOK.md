# Operational Runbook

This runbook provides step-by-step procedures for common operational tasks in StellarStream.  
For initial production setup, refer to the **[Deployment Guide](DEPLOYMENT.md)**.

## Table of Contents
1. [Reset SQLite Database](#reset-sqlite-database)
2. [Rotate JWT Secret](#rotate-jwt-secret)
3. [Force Indexer Reconcile](#force-indexer-reconcile)
4. [Requeue Dead-Letter Webhooks](#requeue-dead-letter-webhooks)
5. [Archive Old Streams Manually](#archive-old-streams-manually)
6. [Indexer Falls Behind](#indexer-falls-behind)
7. [Indexer Monitoring Outcome Signal](#indexer-monitoring-outcome-signal)
8. [Webhook Dead-Letter Spike](#webhook-dead-letter-spike)
9. [Webhook Delivery Outcome Signal](#webhook-delivery-outcome-signal)
10. [SQLite WAL Size Growth](#sqlite-wal-size-growth)
11. [Contract Invocation Timeout](#contract-invocation-timeout)
12. [Contract CI Outcome Signal](#contract-ci-outcome-signal)

---

### Reset SQLite Database
**Prerequisites:**
- Access to the server's filesystem.
- Backend service stopped (recommended).

**Steps:**
1. Stop the backend service.
2. Navigate to the `backend/data` directory.
3. Delete the database file:
   ```bash
   rm backend/data/streams.db
   ```
4. Restart the backend service.

**Expected Output:**
- Backend logs show: `Database initialized.` and `migrate()` running.
- A new `streams.db` file is created.

---

### Rotate JWT Secret
**Prerequisites:**
- Access to the backend environment variables or `.env` file.

**Steps:**
1. Generate a new random secret:
   ```bash
   openssl rand -hex 32
   ```
2. Update the `JWT_SECRET` value in your environment or `backend/.env` file.
3. Restart the backend service.

**Expected Output:**
- All existing user sessions are invalidated.
- Users will be prompted to re-connect their wallets and sign a new challenge.

**Validation from Clean Environment:**
To verify the rotation works without undocumented local state:
1. Provision a fresh backend instance (or container) with the new `JWT_SECRET` only
2. No database migration or prior state required - the secret is read at startup
3. Issue a new challenge via `GET /api/auth/challenge` and complete auth flow
4. Verify `POST /api/auth/token` returns a valid JWT signed with the new secret.

---

### Rotate Server Signing Key
**Prerequisites:**
- Access to the backend environment variables or `.env` file.
- A Stellar keypair (secret key starting with `S...`)

**Steps:**
1. Generate a new Stellar keypair:
   ``bash
   # Using Stellar CLI
   stellar keys generate server-signing-new
   # or via Node.js:
   node -e "const {Keypair} = require('@stellar/stellar-sdk'); const kp = Keypair.random(); console.log('Secret:', kp.secret()); console.log('Public:', kp.publicKey());"
   ```
2. Fund the new public key on-chain with XLM for transaction fees (testnet: friendbot).
3. Update the `SERVER_SIGNING_KEY` value in your environment or `backend/.env` file.
4. Restart the backend service.

**Expected Output:**
- All existing SEP-10 challenges issued with the old key become invalid.
- New challenges via `GET /api/auth/challenge` are signed with the new key.
- Clients must request a new challenge and re-sign to authenticate.

**Validation from Clean Environment:**
To verify the rotation works without undocumented local state:
1. Provision a fresh backend instance (or container) with the new `SERVER_SIGNING_KEY` only
2. No database migration or prior state required - the key is read at startup
3. Issue a new challenge via `GET /api/auth/challenge?accountId=<client>`
4. Client signs the challenge and submits via `POST /api/auth/token`
5. Verify a valid JWT is returned (signed with current `JWT_SECRET`)

**Note on Combined Rotation:**
Both `JWT_SECRET` and `SERVER_SIGNING_KEY` can be rotated simultaneously by updating both environment variables and restarting once. The order of operations does not matter as both are loaded at startup.

---

### Force Indexer Reconcile
**Prerequisites:**
- Access to the backend environment variables.

**Steps:**
1. Identify the ledger sequence number you want to re-index from.
2. Set the `INDEXER_START_LEDGER` environment variable:
   ``bash
   # Example: Re-index from ledger 1234567
   export INDEXER_START_LEGGER=1234567
   ```
3. Restart the backend service.

**Expected Output:**
- Backend logs show: `INDEXER_START_LEDGER override active: starting from ledger 1234567`.
- The indexer will process events starting from that ledger, potentially updating local records.

---

### Requeue Dead-Letter Webhooks
**Prerequisites:**
- An admin JWT or access to the database.
- The ID of the dead-letter record.

**Steps:**
1. Get the list of dead-letter webhooks:
   ```bash
   curl -H "Authorization: Bearer <ADMIN_TOKEN>" http://localhost:3001/api/webhooks/dead-letters
   ```
2. Re-queue a specific webhook using its ID:
   ``bash
   curl  -X POST -H "Authorization: Bearer <ADMIN_TOKEN>" http://localhost:3001/api/webhooks/dead-letters/<ID>/requeue
   ```

**Expected Output:**
- JSON response: `{ "success": true, "message": "Webhook re-queued successfully" }`.
- The record is moved from `webhook_dead_letters` back to `webhook_deliveries`.

---

### Archive Old Streams Manually
**Prerequisites:**
- Node.js environment on the server.

**Steps:**
Currently, archiving is defined in the codebase but not exposed via a CLI or API. To trigger it manually, you can use a small script:
1. Create a file `archive.js`:
   ```javascript
   const { initDb } = require('./dist/services/db');
   const { archiveOldStreams } = require('./dist/services/streamStore');

   async function run() {
     initDb();
     const archived = await archiveOldStreams();
     console.log(`Archived ${archived} streams.`);
     process.exit(0);
   }
   run();
   ```
2. Run the script:
   ```bash
   node archive.js
   ```

**Expected Output:**
- Console log showing the number of streams archived (completed > 30 days ago).

---

### Indexer Falls Behind
**Symptoms:**
- Stream statuses in the dashboard are stale (e.g., a completed stream still shows "active").
- `indexer_latest_ledger` advances while `last_indexed_ledger` does not, and `indexer_ledger_lag` rises.
- `indexer_errors_total` increases or `indexer_circuit_state` is `1` (HALF_OPEN) or `2` (OPEN).
- `indexer_outcome` is `1` (transient_delay) or `2` (blocked) — see [Indexer Monitoring Outcome Signal](#indexer-monitoring-outcome-signal).

**Diagnosis:**
1. Read indexer metrics (add configured metrics authentication if enabled):
   ```bash
   curl -s http://localhost:3001/metrics | grep -E '{^(indexer_latest_ledger|last_indexed_ledger|indexer_ledger_lag|indexer_errors_total|indexer_circuit_state)'
   ```
2. Compare the reported head with a direct `getLatestLedger` call to the configured RPC endpoint. If the direct call succeeds and the RPC-head gauge advances, RPC is reachable; if the direct call fails or times out, treat this as an RPC/provider connectivity incident.
   ```bash
   curl -s <STELLAR_RPC_URL> -X POST \
     -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","id":1,"method":"getLatestLedger"}' | \
     jq '.result.sequence'
   ```
3. Check the persisted retry boundary and recent indexer errors:
   ```bash
   sqlite3 backend/data/streams.db "SELECT last_ledger_sequence FROM indexer_cursor WHERE id = 1;"
   journalctl -u stellar-stream-backend --since "10 minutes ago" | grep -i indexer
   ```
   Or if running via PM2:
   ``bash
   pm2 logs stellar-stream-backend --lines 200 | grep -i indexer
   ```

**Remediation:**
1. **RPC rate limit or disconnection:** Do not issue repeated manual event requests or repeatedly restart the service. The indexer makes one normal poll attempt per configured polling interval (default 10 seconds), opens its circuit after 5 consecutive poll failures, waits `CIRCUIT_BREAKER_TIMEOUT_MS` (default 60 seconds), then makes a single half-open probe. A failed probe reopens the circuit; a successful probe closes it. There is no separate immediate retry, `Retry-After` handling, or provider failover.
2. Verify RPC availability and provider rate-limit status, then restore network access or reduce competing RPC traffic. Preserve the database and `indexer_cursor`; the next scheduled poll/probe retries from the last persisted checkpoint. A partially fetched cursor page is safe to replay: event writes are idempotent, and the checkpoint advances only after the full scan and checkpoint write succeed.
   ```bash
   curl -s --max-time 10 <STELLAR_RPC_URL> -X POST \
     -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","id":1,"method":"getLatestLedger"}'
   ```
3. **Lag continues to rise while RPC is healthy:** Confirm the RPC head is advancing, `indexer_errors_total` is flat, and the database is writable. Let complete polls proceed; a successful scan of a range with no contract events still advances the checkpoint. Avoid lowering the polling interval during a rate-limit incident.
4. **Verify recovery:** Require `indexer_circuit_state` to return to `0` (CLOSED), `last_indexed_ledger` to catch up to the observed RPC head, and `indexer_ledger_lag` to reach `0` after a complete poll. Confirm the database cursor matches the indexed-ledger gauge and that indexer errors remain flat for at least two poll intervals.
5. **Stop and roll back if recovery is not verified:** If lag still grows after two circuit-breaker timeouts with RPC healthy, or the RPC remains unavailable, stop the backend, preserve the database/cursor, and restore the last known-good RPC URL and deployment configuration before restarting once. If that does not restore the checks above, leave the service stopped and escalate to the RPC provider/on-call maintainer. Do not delete the database, rewind `indexer_cursor`, or set `INDEXER_START_LEDGER` as a recovery shortcut.

---

### Indexer Monitoring Outcome Signal
**Symptoms:**
- Alert on the `indexer_outcome` Prometheus gauge changing from `0`.
- `GET /api/indexer/monitoring` returns `outcome: "transient_delay"` or `outcome: "blocked"`.
- `indexer_circuit_state` is `1` (HALF_OPEN) or `2` (OPEN).

The signal collapses the indexer's poll health into three outcomes so the two cases
(`lag increasing while RPC is healthy` and `RPC rate limit or disconnection`) map to
an explicit owner action instead of raw counters.

**Outcome meanings:**

| Outcome | Gauge value | Meaning | Owner action |
| --- | --- | --- | --- |
| `success` | 0 | Circuit CLOSED, no consecutive poll failures; the checkpoint is current. A non-zero `ledgerLag` is expected between polls. | None. |
| `transient_delay` | 1 | One or more consecutive polls failed with a retryable provider condition (rate limit or disconnection), or the breaker is HALF_OPEN probing recovery. The retry budget is intact. | None while `consecutiveFailures` stays below `failureThreshold` — the next scheduled poll retries. |
| `blocked` | 2 | Consecutive failures reached the threshold and the circuit is OPEN, or work is outstanding with no RPC endpoint/contract configured. | Verify RPC availability and provider rate-limit status, restore network access or reduce competing RPC traffic; let the half-open probe recover. |

**Diagnosis:**
1. Read the signal. It reports ledgers, counts and enumerated state only — never the
   RPC URL, contract ID, credentials, or a raw provider message, so it is safe to paste
   into an incident channel:
   ``bash
   curl -s -H "Authorization: Bearer <ADMIN_TOKEN>" \
     http://localhost:3001/api/indexer/monitoring | jq
   ```
2. Cross-check the raw gauges on the Prometheus scrape:
   ```bash
   curl -s http://localhost:3001/metrics | grep -E '^(indexer_outcome|indexer_circuit_state|indexer_ledger_lag|indexer_errors_total)'
   ```

**Remediation:**
1. `blocked` with `state.circuitState` = `"OPEN"` — the indexer exhausted its retry
   budget. Follow [Indexer Falls Behind](#indexer-falls-behind) remediation steps 1–2:
   verify RPC availability and provider rate-limit status, restore network access or
   reduce competing RPC traffic, and let the scheduled poll/probe recover.

---

### Webhook Dead-Letter Spike
**Symptoms:**
- A growing number of records in `webhook_dead_letters`.
- Customers report missing or delayed webhook notifications.

**Diagnosis:**
1. Check the dead-letter count:
   ``bash
   sqlite3 backend/data/streams.db "SELECT COUNT(*) FROM webhook_dead_letters;"
   ```
2. Inspect recent failures:
   ```bash
   sqlite3 backend/data/streams.db "SELECT id, url, attempts, last_error FROM webhook_dead_letters ORDER BY id DESC LIMIT 10;"
   ```

**Remediation:**
1. Re-queue the affected records once the consumer endpoint is fixed (see [Requeue Dead-Letter Webhooks](#requeue-dead-letter-webhooks)).
2. If failures continue, check the consumer's HTTP status codes and response times.

---

### Webhook Delivery Outcome Signal

**Symptoms:**
- Alert on the `webhook_outcome` Prometheus gauge changing from `0`.
- `GET /api/webhooks/monitoring` returns `outcome: "transient_delay"` or `outcome: "blocked"`.

The signal collapses webhook delivery health into three outcomes so the two cases
(`transient HTTP failure` and `dead-letter backlog`) map to an explicit owner action
instead of raw counters.

**Outcome meanings:**

| Outcome | Gauge value | Meaning | Owner action |
| --- | --- | --- | --- |
| `success` | 0 | No dead-letter records and no recent failures. | None. |
| `transient_delay` | 1 | Recent delivery failures but the retry budget is intact. | None while retries remain within budget. |
| `blocked` | 2 | Dead-letter records exist or the retry budget is exhausted. | Requeue dead-letter webhooks after fixing the consumer endpoint. |

**Diagnosis:**
1. Read the signal:
   ```bash
   curl -s -H "Authorization: Bearer <ADMIN_TOKEN>" \
     http://localhost:3001/api/webhooks/monitoring | jq
   ```
2. Cross-check the raw gauges:
   ```bash
   curl -s http://localhost:3001/metrics | grep -E '{^(webhook_outcome|webhook_dead_letters_total|webhook_failures_total)'
   ```

**Remediation:**
1. `blocked` — follow [Requeue Dead-Letter Webhooks](#requeue-dead-letter-webhooks) after confirming the consumer endpoint is healthy.

---

### SQLite WAL Size Growth

**Symptoms:**
- The `-wal` file grows without bound.
- Disk usage increases and queries may slow down.

**Diagnosis:**
1. Check the WAL file size:
   ```bash
   ls -lh backend/data/streams.db-wal
   ```
2. Check the current journal mode:
   ```bash
   sqlite3 backend/data/streams.db "PRAGMA journal_mode;"
   ```

**Remediation:**
1. Trigger a WAL checkpoint to allow SQLite to reuse the WAL:
   ```bash
   sqlite3 backend/data/streams.db "PRAGMA wal_checkpoint(truncate); VACUUM;"
   ```
2. If the WAL continues to grow, check for long-running read transactions that prevent checkpointing.

---

### Contract Invocation Timeout

**Symptoms:**
- API requests that invoke the Soroban contract time out or return a connection error.
- Backend logs show RPC timeouts while building or submitting transactions.

**Diagnosis:**
1. Confirm the configured RPC endpoint is reachable:
   ```bash
   curl -s --max-time 10 <STELLAR_RPC_URL> -X POST \
     -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","id":1,"method":"getLatestLedger"}'
   ```
2. Check backend logs for the failing transaction hash and the RPC error message.

**Remediation:**
1. If the RPC is unreachable, restore network access or switch to a known-good RPC endpoint.
2. If the RPC is reachable but slow, increase the client timeout and retry once.
3. If timeouts persist, escalate to the RPC provider.

---

### Contract CI Outcome Signal

**Symptoms:**
- The `Contract CI` workflow failed or was blocked.
- The workflow step summary reports `Contract CI outcome: transient_delay` or `Contract CI outcome: blocked`.
- The workflow step summary reports `Toolchain mismatch: expected=... actual=...`.

The workflow classifies the `Rust contract change with generated bindings` job
outcome into three values so the cases (`toolchain mismatch` and `transient build/bindings
failure`) map to an explicit owner action instead of raw logs. The signal reports only the
classification and the expected/actual toolchain channel names — not secrets, RPC URLs, or
contract IDs — so it is safe to paste into an incident channel.

**Outcome meanings:**

| Outcome | Meaning | Owner action |
| --- | --- | --- |
| `success` | Toolchain matches `rust-toolchain.toml` and both the contract build and binding generation succeeded. | None. |
| `transient_delay` | Toolchain matches but the contract build or binding generation failed (e.g., RPC or registry timeout). The retry budget is intact. | Re-run the workflow once; if it repeats, follow [Contract Invocation Timeout](#contract-invocation-timeout). |
| `blocked` | The toolchain channel in `rust-toolchain.toml` does not match the installed Rust toolchain. | Update `rust-toolchain.toml `channel` to match the installed toolchain (or pin the workflow toolchain to the committed channel), then re-run the workflow. |

**Diagnosis:**
1. Open the failed workflow run and read the `Classify outcome` step summary.
2. Compare the reported `expected=` and `actual=` toolchain channels with `rust-toolchain.tom``.
3. Confirm the local toolchain version:
   ``bash
   rustup show active-toolchain
   ```

**Remediation:**
1. `blocked` — update `rust-toolchain.toml` `channel` to the installed toolchain, or pin the workflow toolchain to the committed channel, then re-run the workflow.
2. `transient_delay` — re-run the workflow once. If the outcome repeats, follow [Contract Invocation Timeout](#contract-invocation-timeout).
3. `success` — no action required.
