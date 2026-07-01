import Database from "better-sqlite3";
import path from "path";

const DB_PATH =
  process.env.DB_PATH || path.join(__dirname, "..", "..", "data", "streams.db");

let db: any;

export function getDb(): any {
  if (!db) {
    throw new Error("Database not initialized. Call initDb() first.");
  }
  return db;
}

export function initDb(): void {
  const dir = path.dirname(DB_PATH);
  const fs = require("fs");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  db = new Database(DB_PATH);
  // WAL mode: better concurrency, allows readers and writers in parallel
  db.pragma("journal_mode = WAL");
  // Foreign keys: enforce referential integrity
  db.pragma("foreign_keys = ON");
  // Balanced durability/performance: fsync on commit but not every write
  db.pragma("synchronous = NORMAL");
  // Prevent SQLITE_BUSY errors during concurrent writes by waiting up to 5 seconds
  db.pragma("busy_timeout = 5000");
  // 64MB page cache for improved read performance
  db.pragma("cache_size = -64000");

  migrate();
}

function migrate(): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS streams (
      id              TEXT PRIMARY KEY,
      sender          TEXT NOT NULL,
      recipient       TEXT NOT NULL,
      asset_code      TEXT NOT NULL,
      total_amount    REAL NOT NULL,
      duration_seconds INTEGER NOT NULL,
      start_at        INTEGER NOT NULL,
      created_at      INTEGER NOT NULL,
      canceled_at     INTEGER,
      completed_at    INTEGER,
      refunded_amount REAL,
      archived_at     INTEGER,
      paused_at       INTEGER,
      paused_duration INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS stream_archive (
      id              TEXT PRIMARY KEY,
      sender          TEXT NOT NULL,
      recipient       TEXT NOT NULL,
      asset_code      TEXT NOT NULL,
      total_amount    REAL NOT NULL,
      duration_seconds INTEGER NOT NULL,
      start_at        INTEGER NOT NULL,
      created_at      INTEGER NOT NULL,
      canceled_at     INTEGER,
      completed_at    INTEGER,
      refunded_amount REAL,
      archived_at     INTEGER NOT NULL,
      paused_at       INTEGER,
      paused_duration INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS stream_events (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      stream_id       TEXT NOT NULL,
      event_type      TEXT NOT NULL,
      ledger_sequence INTEGER,
      timestamp       INTEGER NOT NULL,
      actor           TEXT,
      amount          REAL,
      metadata        TEXT,
      FOREIGN KEY (stream_id) REFERENCES streams(id)
    );

    CREATE INDEX IF NOT EXISTS idx_stream_events_stream_id ON stream_events(stream_id);
    CREATE INDEX IF NOT EXISTS idx_stream_events_timestamp ON stream_events(timestamp);
    CREATE INDEX IF NOT EXISTS idx_stream_events_event_type ON stream_events(event_type);
    CREATE INDEX IF NOT EXISTS idx_stream_events_actor ON stream_events(actor);

    CREATE UNIQUE INDEX IF NOT EXISTS idx_stream_events_dedup
      ON stream_events(stream_id, event_type, ledger_sequence)
      WHERE ledger_sequence IS NOT NULL;

    CREATE TABLE IF NOT EXISTS webhook_deliveries (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      stream_id       TEXT NOT NULL,
      event           TEXT NOT NULL,
      payload         TEXT NOT NULL,
      attempt         INTEGER NOT NULL DEFAULT 0,
      max_attempts    INTEGER NOT NULL DEFAULT 3,
      status          TEXT NOT NULL DEFAULT 'pending',
      next_retry_at   INTEGER,
      created_at      INTEGER NOT NULL,
      last_attempt_at INTEGER,
      error_message   TEXT,
      FOREIGN KEY (stream_id) REFERENCES streams(id)
    );

    CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_status ON webhook_deliveries(status);
    CREATE INDEX IF NOT EXISTS idx_webhook_deliveries_next_retry ON webhook_deliveries(next_retry_at);

    CREATE TABLE IF NOT EXISTS webhook_dead_letters (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      stream_id       TEXT NOT NULL,
      event           TEXT NOT NULL,
      url             TEXT NOT NULL,
      payload         TEXT NOT NULL,
      last_error      TEXT,
      failed_at       INTEGER NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_webhook_dead_letters_failed_at ON webhook_dead_letters(failed_at);

    CREATE TABLE IF NOT EXISTS indexer_cursor (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      last_ledger_sequence INTEGER NOT NULL
    );

    CREATE VIRTUAL TABLE IF NOT EXISTS streams_fts USING fts5(
      stream_id UNINDEXED,
      sender,
      recipient,
      asset_code,
      content=streams,
      content_rowid=rowid
    );
  `);

  // Incremental migrations — safe to run on existing databases.
  const addColumnIfMissing = (table: string, column: string, definition: string) => {
    const cols = db.pragma(`table_info(${table})`) as Array<{ name: string }>;
    if (!cols.some((c) => c.name === column)) {
      db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
    }
  };

  addColumnIfMissing("streams", "paused_at", "INTEGER");
  addColumnIfMissing("streams", "paused_duration", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing("streams", "metadata", "TEXT");
  addColumnIfMissing("streams", "cliff_seconds", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing("stream_archive", "paused_at", "INTEGER");
  addColumnIfMissing("stream_archive", "paused_duration", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing("stream_archive", "metadata", "TEXT");
  addColumnIfMissing("stream_archive", "cliff_seconds", "INTEGER NOT NULL DEFAULT 0");
  addColumnIfMissing("webhook_dead_letters", "stream_id", "TEXT NOT NULL DEFAULT ''");
  addColumnIfMissing("webhook_dead_letters", "event", "TEXT NOT NULL DEFAULT ''");

  // Rebuild FTS5 index if it exists (for production data)
  try {
    db.exec("INSERT INTO streams_fts(streams_fts, rank) VALUES('rebuild', -1)");
  } catch {
    // FTS table may not exist or rebuild may not be needed; continue
  }
}

export function syncFtsIndex(streamId: string, sender: string, recipient: string, assetCode: string): void {
  try {
    db.prepare(
      `INSERT INTO streams_fts(rowid, stream_id, sender, recipient, asset_code)
       VALUES ((SELECT rowid FROM streams WHERE id = ?), ?, ?, ?, ?)
       ON CONFLICT(rowid) DO UPDATE SET
         sender = excluded.sender,
         recipient = excluded.recipient,
         asset_code = excluded.asset_code`
    ).run(streamId, streamId, sender, recipient, assetCode);
  } catch {
    // FTS update failed; log but don't crash
  }
}

export function searchStreamsFts(query: string): string[] {
  try {
    const rows = db.prepare(
      `SELECT stream_id FROM streams_fts WHERE streams_fts MATCH ? ORDER BY rank`
    ).all(query) as Array<{ stream_id: string }>;
    return rows.map((row) => row.stream_id);
  } catch {
    return [];
  }
}
