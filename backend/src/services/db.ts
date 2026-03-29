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
  db.pragma("journal_mode = WAL");
  db.pragma("foreign_keys = ON");

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
      completed_at    INTEGER
    );

    CREATE TABLE IF NOT EXISTS stream_events (
      id              INTEGER PRIMARY KEY AUTOINCREMENT,
      stream_id       TEXT NOT NULL,
      event_type      TEXT NOT NULL,
      timestamp       INTEGER NOT NULL,
      actor           TEXT,
      amount          REAL,
      metadata        TEXT,
      FOREIGN KEY (stream_id) REFERENCES streams(id)
    );

    CREATE INDEX IF NOT EXISTS idx_stream_events_stream_id ON stream_events(stream_id);
    CREATE INDEX IF NOT EXISTS idx_stream_events_timestamp ON stream_events(timestamp);

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

    CREATE TABLE IF NOT EXISTS indexer_cursor (
      id TEXT PRIMARY KEY,
      last_ledger INTEGER NOT NULL
    );
  `);
}
