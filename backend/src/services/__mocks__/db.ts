import Database from "better-sqlite3";
let db: any = null;
export function getDb(): any {
  if (!db) {
    db = new Database(":memory:");
    db.exec("CREATE TABLE IF NOT EXISTS streams (id TEXT, status TEXT)");
    db.exec("CREATE TABLE IF NOT EXISTS webhook_deliveries (id INTEGER PRIMARY KEY)");
    db.exec("CREATE TABLE IF NOT EXISTS webhook_dead_letters (id INTEGER PRIMARY KEY, stream_id TEXT, event TEXT, failed_at TEXT)");
    db.exec("CREATE TABLE IF NOT EXISTS stream_events (id INTEGER PRIMARY KEY, stream_id TEXT)");
  }
  return db;
}
export function initDb(): void { getDb(); }
