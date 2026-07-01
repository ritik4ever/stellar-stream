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
  archived_at     INTEGER
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
  archived_at     INTEGER NOT NULL
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
