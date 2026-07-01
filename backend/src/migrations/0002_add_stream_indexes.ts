/**
 * backend/src/migrations/0002_add_stream_indexes.ts
 *
 * Programmatic version of the SQL migration. Import and call `up(db)` from
 * your db initialisation logic (db.ts), or run this file directly with ts-node.
 *
 * The migration is idempotent: `CREATE INDEX IF NOT EXISTS` is a no-op when
 * the index already exists, so it is safe to call on every startup.
 */

import Database from "better-sqlite3";

export function up(db: Database.Database): void {
  db.exec(`
    -- 1. sender lookup
    CREATE INDEX IF NOT EXISTS idx_streams_sender
        ON streams(sender);

    -- 2. recipient lookup
    CREATE INDEX IF NOT EXISTS idx_streams_recipient
        ON streams(recipient);

    -- 3. status (derived from three nullable timestamp columns)
    CREATE INDEX IF NOT EXISTS idx_streams_status
        ON streams(canceled_at, completed_at, paused_at);

    -- 4. start_at range scans / ordering
    CREATE INDEX IF NOT EXISTS idx_streams_start_at
        ON streams(start_at);
  `);

  console.log("[migration] 0002_add_stream_indexes: indexes applied.");
}

// ── Allow running directly: ts-node src/migrations/0002_add_stream_indexes.ts
if (require.main === module) {
  const dbPath = process.env.DB_PATH ?? "backend/data/streams.db";
  const db = new Database(dbPath);
  up(db);
  db.close();
}