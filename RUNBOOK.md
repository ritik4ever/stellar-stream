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
7. [Webhook Dead-Letter Spike](#webhook-dead-letter-spike)
8. [SQLite WAL Size Growth](#sqlite-wal-size-growth)
9. [Contract Invocation Timeout](#contract-invocation-timeout)

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
- Backend logs show `lastLedger` lagging behind the current Stellar network ledger sequence.
- Alert: `indexer_lag_seconds` exceeds threshold (configurable, default 300s).

**Diagnosis:**
1. Check the current indexer cursor position:
   ```bash
   sqlite3 backend/data/streams.db "SELECT key, value FROM indexer_cursor;"
   ```
2. Compare with the latest Stellar ledger sequence (using the RPC endpoint):
   ```bash
   curl -s <STELLAR_RPC_URL> -X POST \
     -H "Content-Type: application/json" \
     -d '{"jsonrpc":"2.0","id":1,"method":"getLatestLedger"}' | \
     jq '.result.sequence'
   ```
3. Check backend logs for indexer errors:
   ```bash
   journalctl -u stellar-stream-backend --since "10 minutes ago" | grep -i indexer
   ```
   Or if running via PM2:
   ```bash
   pm2 logs stellar-stream-backend --lines 200 | grep -i indexer
   ```

**Remediation:**
1. **Network issue:** Verify the backend can reach the Stellar RPC endpoint:
   ```bash
   curl -s --max-time 5 <STELLAR_RPC_URL>/health
   ```
   If unreachable, check firewall rules and RPC provider status.
2. **Backoff stuck:** Restart the backend to reset the indexer's exponential backoff:
   ```bash
   pm2 restart stellar-stream-backend
   ```
   Or if using systemd:
   ```bash
   systemctl restart stellar-stream-backend
   ```
3. **Force re-index from a specific ledger** (use with caution—this may process duplicate events):
   ```bash
   export INDEXER_START_LEDGER=<LEDGER_SEQUENCE>
   pm2 restart stellar-stream-backend
   ```
4. **Persistent lag:** If the indexer consistently falls behind, reduce the polling interval by setting `INDEXER_POLL_INTERVAL_MS` to a lower value (e.g., `5000` for 5 seconds) in the backend `.env`.

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
