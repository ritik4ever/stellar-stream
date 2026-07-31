import Database from "better-sqlite3";

export function up(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS indexer_cursor (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      last_ledger_sequence INTEGER NOT NULL
    );
  `);
}

export function down(db: Database.Database): void {
  db.exec(`DROP TABLE IF EXISTS indexer_cursor;`);
}

if (require.main === module) {
  const dbPath = process.env.DB_PATH ?? "backend/data/streams.db";
  const db = new Database(dbPath);
  up(db);
  db.close();
}
