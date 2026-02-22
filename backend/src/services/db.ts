import Database from "better-sqlite3";
import path from "path";

const DB_PATH =
  process.env.DB_PATH || path.join(__dirname, "..", "..", "data", "streams.db");

let db: Database.Database;

export function getDb(): Database.Database {
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
  `);
}
