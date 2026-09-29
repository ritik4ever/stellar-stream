# Operational Runbook

This runbook provides step-by-step procedures for common operational tasks in StellarStream.  
For initial production setup, refer to the **[Deployment Guide](DEPLOYMENT.md)**.

## Table of Contents
1. [Reset SQLite Database](#reset-sqlite-database)
2. [SQLite Restore from Backup](#sqlite-restore-from-backup)
3. [Rotate JWT Secret](#rotate-jwt-secret)
4. [Force Indexer Reconcile](#force-indexer-reconcile)
5. [Requeue Dead-Letter Webhooks](#requeue-dead-letter-webhooks)
6. [Archive Old Streams Manually](#archive-old-streams-manually)
7. [Indexer Falls Behind](#indexer-falls-behind)
8. [Indexer Monitoring Outcome Signal](#indexer-monitoring-outcome-signal)
9. [Webhook Dead-Letter Spike](#webhook-dead-letter-spike)
10. [Webhook Delivery Outcome Signal](#webhook-delivery-outcome-signal)
11. [SQLite WAL Size Growth](#sqlite-wal-size-growth)
12. [Contract Invocation Timeout](#contract-invocation-timeout)

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

### SQLite Restore from Backup

This section covers restoring a SQLite database from a backup (or from a fresh
checkout) where the schema version in the file may differ from the running code.
The procedure is reproducible in a clean environment with no undocumented local
state.

#### How restore detection works

Every time the backend opens the database file, before applying any pending
migrations, it reads the `schema_migrations` table and compares the recorded
schema versions against the migrations bundled with the running code.
The result is published as the `sqlite_restore_outcome` Prometheus gauge and
logged at startup.  The signal carries counts and state only — never the
database path, migration names, or user data — so it is safe to paste into an
incident channel.

| Outcome | Gauge value | What it means | Owner action |
| --- | --- | --- | --- |
| `success` | 0 | Schema matches the running code. | None. |
| `transient_delay` | 1 | The restored file is behind the running code. Pending migrations are applied automatically on startup. | None while the backend starts cleanly. Verify the signal returns to `success` after restart. |
| `blocked` | 2 | The restored file is ahead of the running code: it contains schema versions this build does not know. Forward-only migrations cannot reconcile the difference. | Deploy the code version that wrote the snapshot, or restore a snapshot taken with this build; then confirm the signal returns to `success`. |

#### Taking a backup

Always stop the backend before copying the database directory so WAL pages are
fully checkpointed into the main file.

```bash
# 1. Stop the backend.
pm2 stop stellar-stream-backend   # or: systemctl stop stellar-stream-backend

# 2. Copy the entire data directory — include the -wal and -shm companions.
cp -r /data /data-backup-$(date +%Y%m%d-%H%M%S)

# 3. Restart.
pm2 start stellar-stream-backend
```

If you cannot stop the service, you can use SQLite's online backup API via
`sqlite3` to copy a consistent snapshot without locking the live file:

```bash
sqlite3 /data/streams.db ".backup '/data-backup/streams-$(date +%Y%m%d).db'"
```

The `-wal` and `-shm` files are not needed for a backup produced by `.backup`
because the command writes a fully checkpointed copy.

#### Restoring a backup in a clean environment

These steps reproduce the expected restore outcome without undocumented local
state.  Each scenario can be exercised from a fresh checkout.

**Prerequisites:**
- Access to the server filesystem and the backup file.
- Backend service stopped.
- `sqlite3` available for inspection.

**Steps:**

1. Stop the backend:
   ```bash
   pm2 stop stellar-stream-backend
   ```

2. Replace the database file with the backup:
   ```bash
   # Remove the live file and its WAL companions.
   rm -f /data/streams.db /data/streams.db-wal /data/streams.db-shm

   # Place the backup.
   cp /data-backup/streams-20260101.db /data/streams.db
   ```

3. Inspect the schema versions recorded in the backup:
   ```bash
   sqlite3 /data/streams.db \
     "SELECT version, name, applied_at FROM schema_migrations ORDER BY version;"
   ```

4. Start the backend:
   ```bash
   pm2 start stellar-stream-backend
   ```

5. Read the restore outcome signal immediately after startup:
   ```bash
   curl -s http://localhost:3001/metrics | grep sqlite_restore_outcome
   ```

**Expected output** for each scenario:

| Backup vs. running code | `sqlite_restore_outcome` value | What happens |
| --- | --- | --- |
| Behind (fewer migrations applied) | `1` (transient_delay) | Startup applies the pending migrations automatically. No data is at risk. |
| Matching (same versions) | `0` (success) | No migrations needed. Service starts normally. |
| Ahead (unknown versions) | `2` (blocked) | Startup logs a warning. The service starts but the schema mismatch must be resolved before the service handles requests safely. See remediation below. |
| Fresh file / no schema_migrations | `1` (transient_delay) | All migrations are applied from scratch. Normal path for a clean install. |

#### Restoring after a behind-code backup (transient_delay)

This is the normal case.  The backup was taken at an older schema version; the
running code ships additional migrations.

1. Complete steps 1–4 from the restore procedure above.
2. Check backend logs to confirm migrations ran:
   ```bash
   pm2 logs stellar-stream-backend --lines 50 | grep -i "migration\|schema\|restore"
   ```
   Expected: `SQLite restore outcome recorded` with `outcome: "transient_delay"` and
   then each migration applied.
3. Verify the signal resolves to `success` by comparing the live signal after startup:
   ```bash
   curl -s http://localhost:3001/metrics | grep sqlite_restore_outcome
   # Expected: sqlite_restore_outcome 0
   ```
   Note: the startup-recorded gauge retains the value at the time the database was
   opened (i.e., `1`); the live recomputed value will be `0`.  This is by design —
   the gauge captures the restore state, not the post-migration state.
4. Verify the database schema is current:
   ```bash
   sqlite3 /data/streams.db \
     "SELECT version FROM schema_migrations ORDER BY version;"
   ```
   All expected migration version numbers should appear.

#### Restoring a blocked backup (schema ahead of running code)

This requires operator intervention: the backup contains schema versions the
current build does not know, and forward-only migrations cannot undo them.

**Option A — Roll forward: deploy the newer code.**
If the backup was created by a newer build that is available, deploy that
build instead.  Once the deployed code matches the schema in the backup, the
signal returns to `success`.

**Option B — Roll back: replace with a compatible backup.**
If the newer build is unavailable or undesirable, restore a backup that was
taken with the current (or earlier) schema version and repeat the procedure.

Both options follow the same verification flow: after restarting, confirm
`sqlite_restore_outcome` is `0`.

**Diagnosis:**
```bash
# Count how many applied versions are unknown to the running code:
sqlite3 /data/streams.db \
  "SELECT COUNT(*) FROM schema_migrations;" # compare with discoverMigrations count

# Read the startup log entry (never exposes the database path or migration names):
pm2 logs stellar-stream-backend --lines 100 | grep -i "restore"
```

#### Validation from a clean environment

To confirm the restore behavior is reproducible without undocumented local state:

1. From a fresh checkout, install dependencies: `cd backend && npm install`
2. Run the restore-scenario tests (no running service or live database needed):
   ```bash
   cd backend
   npx vitest run src/services/dbRestoreOutcome.restore.test.ts
   ```
   All 12 tests must pass.  They build temporary in-memory databases at
   specific schema versions and verify the exact outcome signal and Prometheus
   gauge value for each scenario.
3. Optionally, run the full suite to confirm no regressions:
   ```bash
   cd backend && npx vitest run
   ```

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
   ```bash
   # Using Stellar CLI
   stellar keys generate server-signing-new
   # Or via Node.js:
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
   ```bash
   # Example: Re-index from ledger 1234567
   export INDEXER_START_LEDGER=1234567
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
   ```bash
   curl -X POST -H "Authorization: Bearer <ADMIN_TOKEN>" http://localhost:3001/api/webhooks/dead-letters/<ID>/requeue
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
   curl -s http://localhost:3001/metrics | grep -E '^(indexer_latest_ledger|last_indexed_ledger|indexer_ledger_lag|indexer_errors_total|indexer_circuit_state)'
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
   ```bash
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
   ```bash
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
   reduce competing RPC traffic, and let the scheduled poll/half-open probe recover. Do
   not restart the service in a loop.
2. `blocked` with `state.rpcConfigured` = `false` and `state.ledgerLag > 0` — the service
   is running without a Stellar RPC URL or contract ID. Set them and restart once.
3. `transient_delay` — take no action while `consecutiveFailures` stays below
   `failureThreshold`. If the count reaches the threshold the outcome moves to `blocked`;
   see step 1. The `state.lastFailureKind` field separates `rate_limited` from
   `disconnected` without exposing the provider message.
4. `success` with a non-zero `state.ledgerLag` — expected between polls while the chain
   advances; lag alone does not raise the outcome. If lag keeps growing while
   `indexer_outcome` stays `0`, follow [Indexer Falls Behind](#indexer-falls-behind)
   remediation step 3.

---

### Webhook Dead-Letter Spike
**Symptoms:**
- Alert: `webhook_dead_letter_count` exceeds threshold (default > 50).
- Recipients report not receiving stream event notifications.
- Backend logs contain repeated `webhook delivery failed` entries.

**Diagnosis:**
1. Count dead-letter records:
   ```bash
   sqlite3 backend/data/streams.db "SELECT COUNT(*) FROM webhook_dead_letters;"
   ```
2. List recent dead-letter entries with failure reasons:
   ```bash
   sqlite3 backend/data/streams.db \
     "SELECT id, stream_id, event_type, failure_reason, created_at \
      FROM webhook_dead_letters ORDER BY created_at DESC LIMIT 20;"
   ```
3. Check the webhook worker log for connectivity errors:
   ```bash
   journalctl -u stellar-stream-backend --since "30 minutes ago" | grep -i "webhook\|dead.letter\|retry"
   ```

**Remediation:**
1. **Fix the receiver endpoint:** If the downstream webhook receiver is down or returning errors, contact the receiver's operator. Verify the webhook endpoint is reachable:
   ```bash
   curl -s -o /dev/null -w "%{http_code}" --max-time 5 <WEBHOOK_URL>
   ```
2. **Re-queue dead-letter webhooks** after the receiver is healthy:
   ```bash
   curl -X POST -H "Authorization: Bearer <ADMIN_TOKEN>" \
     http://localhost:3001/api/webhooks/dead-letters/requeue-all
   ```
   Or requeue individually via the admin API (see [Requeue Dead-Letter Webhooks](#requeue-dead-letter-webhooks)).
3. **Increase retry attempts** if the receiver is slow but healthy: set `WEBHOOK_MAX_RETRIES` in the backend `.env` (default: 3, max recommended: 6).
4. **Inspect dead-letter payloads** to rule out malformed data:
   ```bash
   sqlite3 backend/data/streams.db \
     "SELECT id, payload FROM webhook_dead_letters ORDER BY created_at DESC LIMIT 5;" | \
     jq '.'
   ```

---

### Webhook Delivery Outcome Signal
**Symptoms:**
- Alert on the `webhook_outcome` Prometheus gauge changing from `0`.
- `GET /api/webhooks/monitoring` returns `outcome: "blocked"`.
- Recipients report missing stream event notifications.

**Outcome meanings:**

| Outcome | Gauge value | Meaning | Owner action |
| --- | --- | --- | --- |
| `success` | 0 | Nothing queued, nothing dead-lettered. | None. |
| `transient_delay` | 1 | Deliveries are waiting out a backoff window; the retry budget is intact. | None while the queued count falls — the worker clears these on its own. |
| `blocked` | 2 | The destination exhausted its retry budget, or work is queued with no destination configured. | Verify the receiver, then requeue; or set `WEBHOOK_DESTINATION_URL`. |

**Diagnosis:**
1. Read the signal. It reports counts and state only — never the destination URL, a payload, or a stream ID, so it is safe to paste into an incident channel:
   ```bash
   curl -s -H "Authorization: Bearer <ADMIN_TOKEN>" \
     http://localhost:3001/api/webhooks/monitoring | jq
   ```
2. Cross-check the raw counters on the Prometheus scrape:
   ```bash
   curl -s http://localhost:3001/metrics | grep -E "^webhook_(outcome|queue_|dead_letters)"
   ```

**Remediation:**
1. `blocked` with `counts.deadLetters > 0` — the destination has remained unavailable. Follow [Webhook Dead-Letter Spike](#webhook-dead-letter-spike).
2. `blocked` with `counts.pending > 0` and no destination configured — set `WEBHOOK_DESTINATION_URL` in the backend `.env` and restart the service.
3. `transient_delay` — take no action while the queued count is falling. If it stops draining, inspect the worker log for `webhook delivery scheduled for retry` and confirm the destination is reachable.

---

### SQLite WAL Size Growth
**Symptoms:**
- Disk usage on the backend server is growing unexpectedly.
- The `backend/data/` directory contains a `streams.db-wal` file significantly larger than `streams.db`.
- Alert: WAL file size exceeds 500 MB (configurable threshold).

**Diagnosis:**
1. Check WAL and database file sizes:
   ```bash
   ls -lh backend/data/streams.db*
   ```
2. Confirm WAL mode is active:
   ```bash
   sqlite3 backend/data/streams.db "PRAGMA journal_mode;"
   ```
3. Check how many checkpoints are pending:
   ```bash
   sqlite3 backend/data/streams.db "PRAGMA wal_checkpoint;"
   ```
   Output format: `busy`, `log`, `checkpointed`. A large `log` value (pages) indicates many uncheckpointed writes.
4. Monitor write-heavy workloads:
   ```bash
   sqlite3 backend/data/streams.db \
     "SELECT COUNT(*) FROM streams; SELECT COUNT(*) FROM stream_events; \
      SELECT COUNT(*) FROM webhook_deliveries;"
   ```

**Remediation:**
1. **Force a WAL checkpoint** to flush the WAL into the main database:
   ```bash
   sqlite3 backend/data/streams.db "PRAGMA wal_checkpoint(TRUNCATE);"
   ```
   The WAL file should shrink or disappear after this.
2. **Schedule periodic checkpointing** by adding the following pragmas to `db.ts` after WAL mode is enabled:
   ```sql
   PRAGMA synchronous=NORMAL;
   PRAGMA busy_timeout=5000;
   PRAGMA cache_size=-64000;
   ```
   These reduce WAL spooling and improve concurrency.
3. **Set `PRAGMA wal_autocheckpoint`** to tune checkpoint frequency (default: 1000 pages). For write-heavy workloads, lower it:
   ```bash
   sqlite3 backend/data/streams.db "PRAGMA wal_autocheckpoint=500;"
   ```
4. **Add a periodic cron job** if manual checkpointing is required:
   ```bash
   # Every hour, checkpoint the WAL
   0 * * * * sqlite3 /path/to/streams.db "PRAGMA wal_checkpoint(TRUNCATE);"
   ```
5. **Verify recovery** after remediation:
   ```bash
   ls -lh backend/data/streams.db*
   sqlite3 backend/data/streams.db "PRAGMA wal_checkpoint;"
   ```

---

### Contract Invocation Timeout
**Symptoms:**
- Stream creation, claim, or cancel operations fail with timeout errors.
- Backend logs contain `soroban_contract` errors: `Contract invocation timed out` or `RPC call timed out`.
- Frontend shows "Transaction failed" with no detailed error message.

**Diagnosis:**
1. Check backend logs for contract invocation errors:
   ```bash
   journalctl -u stellar-stream-backend --since "1 hour ago" | grep -i "contract\|soroban\|timeout\|rpc"
   ```
2. Verify the Soroban RPC endpoint is reachable and responsive:
   ```bash
   curl -s --max-time 10 <STELLAR_RPC_URL> -X POST \
     -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","id":1,"method":"getHealth"}' | jq '.'
   ```
3. Check the current network ledger status:
   ```bash
   curl -s --max-time 10 <STELLAR_RPC_URL> -X POST \
     -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","id":1,"method":"getLatestLedger"}' | \
     jq '{sequence: .result.sequence, protocolVersion: .result.protocolVersion}'
   ```
4. Verify the deployed contract ID matches what the backend expects:
   ```bash
   grep SOROBAN_CONTRACT_ID backend/.env
   ```

**Remediation:**
1. **Increase RPC timeout** in the backend `.env`:
   ```bash
   SOROBAN_RPC_TIMEOUT_MS=30000
   ```
   (Default is typically 10000 ms. Increase in increments of 5000 ms.)
2. **Switch to a more reliable RPC provider** if timeouts persist. Update `STELLAR_RPC_URL` in `.env`.
3. **Check rate limits** — some RPC providers throttle high-volume requests. Reduce concurrent contract calls by lowering `SOROBAN_MAX_CONCURRENT_CALLS` (default: 10).
4. **Restart the backend** to clear any stale RPC connections:
   ```bash
   pm2 restart stellar-stream-backend
   ```
5. **Verify the contract is still deployed** at the expected address:
   ```bash
   curl -s --max-time 10 <STELLAR_RPC_URL> -X POST \
     -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","id":1,"method":"getContractData","params":{"contractId":"<SOROBAN_CONTRACT_ID>","key":"..."}}' | \
     jq '.result'
   ```
6. **Escalate to the Soroban/SDK team** if the issue is on the Stellar network side (e.g., network congestion or protocol upgrade).
