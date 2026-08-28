/**
 * chaos-indexer-worker.ts
 *
 * Child process spawned by `indexer-kill-restart.ts`. It runs the REAL
 * backend indexer (`backend/src/services/indexer.ts`) against:
 *
 *   - a real SQLite database file in WAL mode (CHAOS_DB_PATH)
 *   - the chaos mock Soroban RPC server (CHAOS_RPC_URL)
 *
 * The parent chaos script SIGKILLs this process mid-poll to simulate a crash,
 * then spawns a fresh copy (same DB, same RPC) to verify the restart behavior:
 *
 *   1. No duplicate events land in `stream_events` (INSERT OR IGNORE + unique
 *      index on (stream_id, event_type, ledger_sequence)).
 *   2. SQLite WAL recovery replays any uncheckpointed frames left behind.
 *
 * Backend modules are loaded via `require()` AFTER environment variables are
 * set, because static `import` statements are hoisted above any statements.
 */
process.env.NODE_ENV = 'test'; // avoid the pino-pretty transport (not installed in CI)
process.env.DB_PATH = process.env.CHAOS_DB_PATH || '';

const RPC_URL = process.env.CHAOS_RPC_URL || '';
const CONTRACT_ID = process.env.CHAOS_CONTRACT_ID || '';
const POLL_INTERVAL_MS = Number(process.env.CHAOS_POLL_INTERVAL_MS || 2000);

// eslint-disable-next-line @typescript-eslint/no-var-requires
const { initDb, getDb } = require('../../backend/src/services/db.ts');
// eslint-disable-next-line @typescript-eslint/no-var-requires
const {
  initIndexer,
  startIndexer,
  stopIndexer,
} = require('../../backend/src/services/indexer.ts');

initDb();
initIndexer(RPC_URL, CONTRACT_ID, 'Test SDF Network ; September 2015');
startIndexer(POLL_INTERVAL_MS);
console.log('[chaos-worker] WORKER_READY');

function shutdown(signal: string): void {
  console.log(`[chaos-worker] received ${signal} — stopping indexer`);
  try {
    stopIndexer();
  } catch {
    // ignore
  }
  try {
    getDb().close();
  } catch {
    // ignore
  }
  process.exit(0);
}

process.on('SIGTERM', () => shutdown('SIGTERM'));
process.on('SIGINT', () => shutdown('SIGINT'));
