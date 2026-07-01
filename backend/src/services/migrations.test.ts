import Database from "better-sqlite3";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  discoverMigrations,
  getMigrationsDir,
  getTableColumns,
  rollbackMigration,
  runMigrations,
} from "./migrations";

const EXPECTED_STREAMS_COLUMNS = [
  "id",
  "sender",
  "recipient",
  "asset_code",
  "total_amount",
  "duration_seconds",
  "start_at",
  "created_at",
  "canceled_at",
  "completed_at",
  "refunded_amount",
  "archived_at",
  "paused_at",
  "paused_duration",
  "metadata",
];

const EXPECTED_WEBHOOK_DEAD_LETTERS_COLUMNS = [
  "id",
  "url",
  "payload",
  "last_error",
  "failed_at",
  "stream_id",
  "event",
];

function createTempDbPath(): string {
  return path.join(
    os.tmpdir(),
    `stellar-stream-migrations-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
  );
}

function openDb(dbPath: string): Database.Database {
  const db = new Database(dbPath);
  db.pragma("foreign_keys = ON");
  return db;
}

describe("database migrations", () => {
  let dbPath: string;
  let db: Database.Database;

  afterEach(() => {
    if (db) {
      db.close();
    }
    if (dbPath && fs.existsSync(dbPath)) {
      fs.unlinkSync(dbPath);
    }
  });

  it("applies all migrations on fresh init and records schema_migrations", () => {
    dbPath = createTempDbPath();
    db = openDb(dbPath);

    runMigrations(db);

    const migrations = discoverMigrations(getMigrationsDir());
    const applied = db
      .prepare("SELECT version, name FROM schema_migrations ORDER BY version")
      .all() as Array<{ version: number; name: string }>;

    expect(applied).toHaveLength(migrations.length);
    expect(applied.map((row) => row.version)).toEqual(
      migrations.map((migration) => migration.version)
    );

    expect(getTableColumns(db, "streams")).toEqual(EXPECTED_STREAMS_COLUMNS);
    expect(getTableColumns(db, "stream_archive")).toEqual(EXPECTED_STREAMS_COLUMNS);
    expect(getTableColumns(db, "webhook_dead_letters")).toEqual(
      EXPECTED_WEBHOOK_DEAD_LETTERS_COLUMNS
    );
  });

  it("applies pending migrations incrementally without re-running applied ones", () => {
    dbPath = createTempDbPath();
    db = openDb(dbPath);

    const migrationsDir = getMigrationsDir();
    const migrations = discoverMigrations(migrationsDir);
    const firstMigration = migrations[0];

    db.exec(fs.readFileSync(firstMigration.upPath, "utf-8"));
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version     INTEGER PRIMARY KEY,
        name        TEXT NOT NULL,
        applied_at  INTEGER NOT NULL
      );
    `);
    db.prepare(
      "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)"
    ).run(firstMigration.version, firstMigration.name, Math.floor(Date.now() / 1000));

    expect(getTableColumns(db, "streams")).not.toContain("metadata");
    expect(getTableColumns(db, "streams")).not.toContain("paused_at");

    runMigrations(db);

    const applied = db
      .prepare("SELECT version FROM schema_migrations ORDER BY version")
      .all() as Array<{ version: number }>;

    expect(applied.map((row) => row.version)).toEqual(
      migrations.map((migration) => migration.version)
    );
    expect(getTableColumns(db, "streams")).toEqual(EXPECTED_STREAMS_COLUMNS);

    runMigrations(db);

    const appliedAfterSecondRun = db
      .prepare("SELECT version FROM schema_migrations ORDER BY version")
      .all() as Array<{ version: number }>;

    expect(appliedAfterSecondRun).toHaveLength(migrations.length);
    expect(getTableColumns(db, "streams")).toEqual(EXPECTED_STREAMS_COLUMNS);
  });

  it("seeds baseline migrations for pre-existing databases", () => {
    dbPath = createTempDbPath();
    db = openDb(dbPath);

    runMigrations(db);
    db.close();

    db = openDb(dbPath);
    db.exec("DELETE FROM schema_migrations");

    runMigrations(db);

    const migrations = discoverMigrations(getMigrationsDir());
    const applied = db
      .prepare("SELECT version FROM schema_migrations ORDER BY version")
      .all() as Array<{ version: number }>;

    expect(applied.map((row) => row.version)).toEqual(
      migrations.map((migration) => migration.version)
    );
    expect(getTableColumns(db, "streams")).toEqual(EXPECTED_STREAMS_COLUMNS);
  });

  it("rolls back the latest migration using the down script", () => {
    dbPath = createTempDbPath();
    db = openDb(dbPath);

    runMigrations(db);

    rollbackMigration(db, 4);

    expect(getTableColumns(db, "webhook_dead_letters")).toEqual([
      "id",
      "url",
      "payload",
      "last_error",
      "failed_at",
    ]);

    const applied = db
      .prepare("SELECT version FROM schema_migrations ORDER BY version")
      .all() as Array<{ version: number }>;

    expect(applied.map((row) => row.version)).toEqual([1, 2, 3]);
  });
});
