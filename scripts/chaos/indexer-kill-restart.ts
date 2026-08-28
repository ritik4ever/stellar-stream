/**
 * indexer-kill-restart.ts
 *
 * Chaos test: kill the indexer worker mid-poll, restart it, and verify the
 * system recovers without duplicate events. Also tests SQLite WAL recovery
 * explicitly.
 *
 * Scenario
 * --------
 *  1. A fresh SQLite DB (WAL mode, real migrations) is seeded with a set of
 *     `streams` and an `indexer_cursor` checkpoint at ledger 1000.
 *  2. A local HTTPS mock of the Soroban RPC serves 1200 contract events
 *     (Created/Claimed) across ledgers 1001–2200, paginated 400 at a time.
 *     Page 2+ responses are delayed so the worker stays "mid-poll".
 *  3. Worker #1 (real backend indexer in a child process) starts polling,
 *     commits page 1 to the WAL, and is then SIGKILL'd before it can save a
 *     checkpoint — the exact crash window that used to produce duplicates.
 *  4. WAL recovery is exercised explicitly: the -wal file is inspected,
 *     the DB is reopened (WAL replay), `integrity_check` and
 *     `wal_checkpoint(TRUNCATE)` are run.
 *  5. Worker #2 restarts against the same DB + RPC and re-processes the whole
 *     range. `INSERT OR IGNORE` + the unique dedup index
 *     (stream_id, event_type, ledger_sequence) must prevent any duplicates.
 *
 * Run via:  npm run test:chaos
 *
 * Exit code 0 = all chaos assertions passed, 1 = a chaos assertion failed.
 */
import Database from 'better-sqlite3';
import { spawn, spawnSync } from 'child_process';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { runMigrations } from '../../backend/src/services/migrations';
import { ChaosEvent, createMockRpcServer, MockRpcServer } from './mock-rpc';

// ── scenario configuration ─────────────────────────────────────────────────────
const CURSOR_LEDGER = 1000; // indexer_cursor checkpoint seeded before the test
const START_LEDGER = CURSOR_LEDGER + 1; // first ledger with contract events
const TOTAL_EVENTS = 1200;
const PAGE_SIZE = 400;
const PAGE_DELAY_MS = 5000; // keeps worker #1 mid-poll while we SIGKILL it
const N_STREAMS = 40;
const POLL_INTERVAL_MS = 2000;
const LATEST_LEDGER = START_LEDGER + TOTAL_EVENTS - 1;
const CONTRACT_ID = 'C' + 'A'.repeat(55); // 56-char strkey, cosmetic

const BACKEND_DIR = path.resolve(__dirname, '..', '..', 'backend');
const TS_NODE_BIN = path.join(
  BACKEND_DIR,
  'node_modules',
  'ts-node',
  'dist',
  'bin.js',
);
const CHAOS_TSCONFIG = path.join(__dirname, 'tsconfig.json');
const WORKER_FILE = path.join(__dirname, 'chaos-indexer-worker.ts');

const OVERALL_TIMEOUT_MS = 180_000;

// ── helpers ────────────────────────────────────────────────────────────────────

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

async function waitFor(
  cond: () => boolean,
  timeoutMs: number,
  what: string,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (cond()) return;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for: ${what}`);
}

/**
 * better-sqlite3 returns pragma values either as a scalar ("wal") or as an
 * array of row objects ([{ journal_mode: "wal" }]); normalize both to a string.
 */
function journalModeValue(pragma: unknown): string {
  if (Array.isArray(pragma)) {
    const first = pragma[0] as Record<string, unknown> | undefined;
    return String(first ? first.journal_mode : '');
  }
  return String(pragma);
}

/** Open a connection configured exactly like the production backend. */
function openDb(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('synchronous = NORMAL');
  db.pragma('busy_timeout = 5000');
  return db;
}

function readEventCount(dbPath: string): number {
  const db = openDb(dbPath);
  try {
    return (
      db.prepare('SELECT COUNT(*) AS c FROM stream_events').get() as {
        c: number;
      }
    ).c;
  } finally {
    db.close();
  }
}

function readCursor(dbPath: string): number {
  const db = openDb(dbPath);
  try {
    const row = db
      .prepare('SELECT last_ledger_sequence FROM indexer_cursor WHERE id = 1')
      .get() as { last_ledger_sequence: number } | undefined;
    return row ? row.last_ledger_sequence : 0;
  } finally {
    db.close();
  }
}

/** Build the deterministic contract-event log served by the mock RPC. */
function buildEvents(): ChaosEvent[] {
  const events: ChaosEvent[] = [];
  for (let i = 0; i < TOTAL_EVENTS; i++) {
    events.push({
      streamId: String((i % N_STREAMS) + 1),
      eventType: i % 2 === 0 ? 'created' : 'claimed',
      ledger: START_LEDGER + i,
      ledgerClosedAt: new Date(1_700_000_000_000 + i * 1000).toISOString(),
      amount: 100 + i,
    });
  }
  return events;
}

/**
 * Create the chaos DB: real migrations (includes the unique dedup index and
 * WAL pragmas), seeded streams so event FKs resolve, and a starting cursor.
 */
function initChaosDb(dbPath: string): void {
  const db = openDb(dbPath);
  try {
    runMigrations(db);
    const now = Math.floor(Date.now() / 1000);
    const insertStream = db.prepare(
      `INSERT INTO streams
         (id, sender, recipient, asset_code, total_amount, duration_seconds, start_at, created_at)
       VALUES (@id, @sender, @recipient, @asset_code, @total_amount, @duration_seconds, @start_at, @created_at)`,
    );
    db.transaction(() => {
      for (let i = 1; i <= N_STREAMS; i++) {
        insertStream.run({
          id: String(i),
          sender:
            `GSENDER0000000000000000000000000000000000000000000000${i}`.slice(
              0,
              56,
            ),
          recipient:
            `GRECIPI0000000000000000000000000000000000000000000000${i}`.slice(
              0,
              56,
            ),
          asset_code: 'USDC',
          total_amount: 1_000_000,
          duration_seconds: 86_400,
          start_at: now,
          created_at: now,
        });
      }
      db.prepare(
        'INSERT INTO indexer_cursor (id, last_ledger_sequence) VALUES (1, @ledger)',
      ).run({ ledger: CURSOR_LEDGER });
    })();
  } finally {
    db.close();
  }
}

function generateSelfSignedCert(dir: string): {
  keyPath: string;
  certPath: string;
} {
  const keyPath = path.join(dir, 'key.pem');
  const certPath = path.join(dir, 'cert.pem');
  const res = spawnSync(
    'openssl',
    [
      'req',
      '-x509',
      '-newkey',
      'rsa:2048',
      '-keyout',
      keyPath,
      '-out',
      certPath,
      '-days',
      '1',
      '-nodes',
      '-subj',
      '/CN=localhost',
    ],
    { stdio: 'pipe' },
  );
  if (res.error) {
    throw new Error(
      'openssl is required to generate the mock RPC TLS certificate: ' +
        res.error.message,
    );
  }
  if (res.status !== 0) {
    throw new Error(
      'openssl certificate generation failed: ' + res.stderr?.toString(),
    );
  }
  return { keyPath, certPath };
}

interface WorkerHandle {
  proc: import('child_process').ChildProcess;
  output: string;
  ready: Promise<void>;
}

function spawnWorker(dbPath: string, rpcUrl: string): WorkerHandle {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    NODE_ENV: 'test',
    NODE_PATH: path.join(BACKEND_DIR, 'node_modules'),
    NODE_TLS_REJECT_UNAUTHORIZED: '0',
    CHAOS_DB_PATH: dbPath,
    CHAOS_RPC_URL: rpcUrl,
    CHAOS_CONTRACT_ID: CONTRACT_ID,
    CHAOS_POLL_INTERVAL_MS: String(POLL_INTERVAL_MS),
    INDEXER_FALLBACK_POLLING_ENABLED: 'false',
  };
  delete env.INDEXER_START_LEDGER;

  const proc = spawn(
    process.execPath,
    [TS_NODE_BIN, '--transpile-only', '--project', CHAOS_TSCONFIG, WORKER_FILE],
    {
      cwd: BACKEND_DIR,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    },
  );

  const handle: WorkerHandle = {
    proc,
    output: '',
    ready: new Promise((resolve, reject) => {
      const timer = setTimeout(
        () => reject(new Error('worker did not become ready')),
        30_000,
      );
      proc.stdout.on('data', (chunk: Buffer) => {
        handle.output += chunk.toString();
        if (handle.output.includes('WORKER_READY')) {
          clearTimeout(timer);
          resolve();
        }
      });
      proc.once('exit', () => {
        clearTimeout(timer);
        reject(new Error('worker exited before becoming ready'));
      });
    }),
  };

  proc.stdout.on('data', (chunk: Buffer) =>
    process.stdout.write(`  [worker] ${chunk}`),
  );
  proc.stderr.on('data', (chunk: Buffer) =>
    process.stdout.write(`  [worker:err] ${chunk}`),
  );

  return handle;
}

function killWorker(
  handle: WorkerHandle,
  signal: NodeJS.Signals,
): Promise<void> {
  return new Promise((resolve) => {
    handle.proc.once('exit', () => resolve());
    handle.proc.kill(signal);
  });
}

function logSection(title: string): void {
  console.log('\n' + '='.repeat(72));
  console.log(title);
  console.log('='.repeat(72));
}

// ── main ───────────────────────────────────────────────────────────────────────

async function main(): Promise<number> {
  const overallTimer = setTimeout(() => {
    console.error('\n❌ Chaos test hit the overall timeout and aborted.');
    process.exit(1);
  }, OVERALL_TIMEOUT_MS);
  overallTimer.unref();

  let failures = 0;
  let mock: MockRpcServer | null = null;
  const workers: WorkerHandle[] = [];

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sstream-chaos-'));
  const dbPath = path.join(tmpDir, 'chaos.db');
  const walPath = dbPath + '-wal';
  const shmPath = dbPath + '-shm';

  const check = (name: string, ok: boolean, detail: string): void => {
    if (!ok) failures++;
    console.log(`  ${ok ? '✅' : '❌'} ${name} — ${detail}`);
  };

  try {
    console.log(
      'StellarStream chaos test: indexer kill / restart / WAL recovery',
    );
    console.log(
      `Scenario: cursor@${CURSOR_LEDGER}, ${TOTAL_EVENTS} events ` +
        `(ledgers ${START_LEDGER}–${LATEST_LEDGER}), page size ${PAGE_SIZE}`,
    );
    console.log(`Temp dir: ${tmpDir}`);

    // ── 1. Setup: certs, DB, mock RPC ───────────────────────────────────────
    logSection('1) Setup');
    const { keyPath, certPath } = generateSelfSignedCert(tmpDir);
    initChaosDb(dbPath);
    console.log(
      '  ✅ DB initialized (WAL, real migrations, seeded streams + cursor)',
    );

    const events = buildEvents();
    mock = await createMockRpcServer({
      contractId: CONTRACT_ID,
      events,
      latestLedger: LATEST_LEDGER,
      pageSize: PAGE_SIZE,
      pageDelayMs: PAGE_DELAY_MS,
      cert: fs.readFileSync(certPath),
      key: fs.readFileSync(keyPath),
    });
    console.log(`  ✅ Mock Soroban RPC listening at ${mock.url}`);

    // ── 2. Worker #1: index until first batch is committed ──────────────────
    logSection('2) Worker #1 — kill mid-poll');
    const worker1 = spawnWorker(dbPath, mock.url);
    workers.push(worker1);
    await worker1.ready;
    console.log('  ✅ Worker #1 started (real indexer)');

    await waitFor(
      () => readEventCount(dbPath) >= PAGE_SIZE,
      30_000,
      'worker to commit its first page of events to the WAL',
    );
    const countBeforeKill = readEventCount(dbPath);
    console.log(
      `  ℹ️  ${countBeforeKill} events committed to the WAL (page served ` +
        `${mock.pageServedCount}, getEvents calls ${mock.getEventsCallCount})`,
    );

    // SIGKILL: no signal handler, no graceful close → crash exactly like a
    // deployment kill/restart while a poll is in flight.
    await killWorker(worker1, 'SIGKILL');
    console.log("  ✅ Worker #1 SIGKILL'd mid-poll (checkpoint never saved)");

    // ── 3. WAL recovery — explicit ──────────────────────────────────────────
    logSection('3) SQLite WAL recovery (explicit)');

    const walExists = fs.existsSync(walPath);
    const walSize = walExists ? fs.statSync(walPath).size : 0;
    const shmExists = fs.existsSync(shmPath);
    check(
      'WAL sidecar files left behind by the crash',
      walExists && walSize > 0 && shmExists,
      `-wal exists=${walExists} size=${walSize}B, -shm exists=${shmExists}`,
    );

    // IMPORTANT: this must be the FIRST connection opened after the crash —
    // a later connection-close would implicitly checkpoint the WAL and the
    // explicit wal_checkpoint below would then have nothing to replay.
    const recoveryDb = openDb(dbPath);
    let countAfterKill = 0;
    try {
      const journalMode = journalModeValue(recoveryDb.pragma('journal_mode'));
      check(
        'journal_mode is WAL',
        journalMode === 'wal',
        `got "${journalMode}"`,
      );

      const integrity = recoveryDb.pragma('integrity_check');
      const integrityOk = Array.isArray(integrity)
        ? integrity.every((r) => Object.values(r as object).join(' ') === 'ok')
        : String(integrity).includes('ok');
      check(
        'integrity_check after WAL replay',
        integrityOk,
        JSON.stringify(integrity),
      );

      // PASSIVE first: reports the real frame counts (TRUNCATE reports 0/0
      // in this SQLite version even when it does the work).
      const passiveResult = recoveryDb.pragma(
        'wal_checkpoint(PASSIVE)',
      ) as unknown;
      const passiveRow = (
        Array.isArray(passiveResult) ? passiveResult[0] : passiveResult
      ) as { busy?: number; log?: number; checkpointed?: number } | undefined;
      const logFrames = Number(passiveRow?.log ?? 0);
      const framesCheckpointed = Number(passiveRow?.checkpointed ?? 0);
      check(
        'WAL contained uncheckpointed frames (wal_checkpoint PASSIVE)',
        logFrames > 0 && framesCheckpointed > 0,
        `log=${logFrames} frames, checkpointed=${framesCheckpointed}`,
      );

      recoveryDb.pragma('wal_checkpoint(TRUNCATE)');
      const walSizeAfter = fs.existsSync(walPath)
        ? fs.statSync(walPath).size
        : 0;
      check(
        'wal_checkpoint(TRUNCATE) truncated the WAL',
        walSizeAfter < walSize,
        `-wal ${walSize}B → ${walSizeAfter}B`,
      );

      const cursorAfterKill = (
        recoveryDb
          .prepare(
            'SELECT last_ledger_sequence FROM indexer_cursor WHERE id = 1',
          )
          .get() as { last_ledger_sequence: number } | undefined
      )?.last_ledger_sequence;
      check(
        'killed worker never advanced the checkpoint',
        cursorAfterKill === CURSOR_LEDGER,
        `indexer_cursor = ${cursorAfterKill} (expected ${CURSOR_LEDGER})`,
      );

      countAfterKill = (
        recoveryDb.prepare('SELECT COUNT(*) AS c FROM stream_events').get() as {
          c: number;
        }
      ).c;
      check(
        'partial batch persisted in WAL',
        countAfterKill >= PAGE_SIZE && countAfterKill < TOTAL_EVENTS,
        `${countAfterKill}/${TOTAL_EVENTS} events present (some but not all)`,
      );
    } finally {
      recoveryDb.close();
    }

    const countAfterRecovery = readEventCount(dbPath);
    check(
      'recovery preserved all committed events',
      countAfterRecovery === countAfterKill,
      `${countAfterRecovery} events (unchanged after recovery)`,
    );

    // ── 4. Worker #2: restart and re-process everything ─────────────────────
    logSection('4) Worker #2 — restart and re-index');
    const worker2 = spawnWorker(dbPath, mock.url);
    workers.push(worker2);
    await worker2.ready;
    console.log('  ✅ Worker #2 started against the same DB + RPC');

    await waitFor(
      () => readEventCount(dbPath) === TOTAL_EVENTS,
      60_000,
      'restarted worker to index the full event set',
    );
    await waitFor(
      () => readCursor(dbPath) === LATEST_LEDGER,
      30_000,
      'restarted worker to checkpoint the latest ledger',
    );
    console.log(
      `  ✅ Worker #2 indexed all ${TOTAL_EVENTS} events and checkpointed ` +
        `ledger ${readCursor(dbPath)}`,
    );

    // ── 5. Final assertions ─────────────────────────────────────────────────
    logSection('5) Final assertions');
    const db = openDb(dbPath);
    try {
      const total = (
        db.prepare('SELECT COUNT(*) AS c FROM stream_events').get() as {
          c: number;
        }
      ).c;
      const distinct = (
        db
          .prepare(
            `SELECT COUNT(DISTINCT stream_id || '|' || event_type || '|' || ledger_sequence) AS c
           FROM stream_events`,
          )
          .get() as { c: number }
      ).c;
      check(
        'no duplicate events after restart',
        total === TOTAL_EVENTS && distinct === TOTAL_EVENTS,
        `rows=${total}, distinct (stream_id,event_type,ledger)=${distinct}, expected ${TOTAL_EVENTS}`,
      );

      const dupRows = (
        db
          .prepare(
            `SELECT stream_id, event_type, ledger_sequence, COUNT(*) AS n
             FROM stream_events
             GROUP BY stream_id, event_type, ledger_sequence
             HAVING n > 1`,
          )
          .all() as Array<Record<string, unknown>>
      ).length;
      check(
        'GROUP BY duplicate scan',
        dupRows === 0,
        `duplicate groups: ${dupRows}`,
      );

      const expected = new Set(
        events.map((e) => `${e.streamId}|${e.eventType}|${e.ledger}`),
      );
      const rows = db
        .prepare(
          'SELECT stream_id, event_type, ledger_sequence FROM stream_events',
        )
        .all() as Array<{
        stream_id: string;
        event_type: string;
        ledger_sequence: number | null;
      }>;
      const unexpected = rows.filter(
        (r) =>
          !expected.has(`${r.stream_id}|${r.event_type}|${r.ledger_sequence}`),
      );
      check(
        'every stored event matches the on-chain log exactly once',
        unexpected.length === 0,
        unexpected.length === 0
          ? 'all rows match the served event set'
          : `unexpected rows: ${JSON.stringify(unexpected.slice(0, 5))}`,
      );

      const finalJournal = journalModeValue(db.pragma('journal_mode'));
      const finalIntegrity = db.pragma('integrity_check');
      const finalIntegrityOk = Array.isArray(finalIntegrity)
        ? finalIntegrity.every(
            (r) => Object.values(r as object).join(' ') === 'ok',
          )
        : String(finalIntegrity).includes('ok');
      check(
        'DB still healthy at end of test',
        finalJournal === 'wal' && finalIntegrityOk,
        `journal=${finalJournal}`,
      );
    } finally {
      db.close();
    }

    // ── 6. Graceful shutdown ────────────────────────────────────────────────
    logSection('6) Cleanup');
    await killWorker(worker2, 'SIGTERM');
    console.log('  ✅ Worker #2 stopped gracefully');
  } catch (err) {
    failures++;
    console.error(
      '\n❌ Chaos test error:',
      err instanceof Error ? err.stack : err,
    );
  } finally {
    for (const w of workers) {
      if (!w.proc.killed) {
        try {
          w.proc.kill('SIGKILL');
        } catch {
          // already gone
        }
      }
    }
    if (mock) {
      await mock.close().catch(() => undefined);
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
    clearTimeout(overallTimer);
  }

  console.log('\n' + '='.repeat(72));
  if (failures === 0) {
    console.log(
      '✅ ALL CHAOS ASSERTIONS PASSED — no duplicate events after restart;',
    );
    console.log('   SQLite WAL recovery verified explicitly.');
  } else {
    console.log(`❌ ${failures} chaos assertion(s) FAILED.`);
  }
  console.log('='.repeat(72));
  return failures === 0 ? 0 : 1;
}

main().then((code) => {
  process.exit(code);
});
