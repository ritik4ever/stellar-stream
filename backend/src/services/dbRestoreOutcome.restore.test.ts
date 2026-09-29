/**
 * backend/src/services/dbRestoreOutcome.restore.test.ts
 *
 * Validates SQLite restore behavior in a clean environment — reproducing
 * issue #1219.
 *
 * Each test constructs a temporary database file that simulates a SQLite
 * backup taken at a known point in time (an older or newer schema version)
 * and then exercises the full restore detection path used by `initDb`.
 *
 * Scope:
 *   - Restore from a prior schema version (fewer migrations applied)
 *   - Restore from a future schema version (unknown migrations)
 *   - Restore from a matching schema version
 *   - Fresh checkout with no prior state (no schema_migrations table)
 *   - Prometheus gauge publishes the correct code for each scenario
 *   - Detail messages carry counts only — never paths, filenames, or secrets
 *
 * All tests are self-contained: they create their own temporary database
 * files and delete them in afterEach, so they reproduce without undocumented
 * local state.
 */

import Database from "better-sqlite3";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SQLITE_RESTORE_OUTCOME_CODES,
  getLiveRestoreOutcomeSignal,
  getRecordedRestoreOutcome,
  recordRestoreOutcome,
  refreshRestoreMetrics,
  resetRecordedRestoreOutcome,
} from "./dbRestoreOutcome";
import { discoverMigrations, getMigrationsDir, runMigrations } from "./migrations";
import { register } from "./metrics";

// ── Shared helpers ────────────────────────────────────────────────────────────

function tmpDbPath(): string {
  return path.join(
    os.tmpdir(),
    `ss-restore-test-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
  );
}

/**
 * Opens a Database and ensures it is closed + deleted in teardown.
 * Returns a dispose function; callers push it to `toCleanup`.
 */
function openDb(filePath: string): Database.Database {
  const db = new Database(filePath);
  db.pragma("foreign_keys = ON");
  return db;
}

/**
 * Builds a minimal SQLite database that simulates a backup taken after
 * exactly `version` migrations were applied.  The schema tables are not
 * actually created here because the restore-outcome logic only reads
 * `schema_migrations`; downstream tests that need full schema use
 * `runMigrations`.
 */
function buildBackupAtVersion(filePath: string, appliedVersions: number[]): void {
  const db = new Database(filePath);
  db.exec(`
    CREATE TABLE schema_migrations (
      version     INTEGER PRIMARY KEY,
      name        TEXT NOT NULL,
      applied_at  INTEGER NOT NULL
    );
  `);
  const insert = db.prepare(
    "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
  );
  for (const v of appliedVersions) {
    insert.run(v, `migration_${v}`, Math.floor(Date.now() / 1000));
  }
  db.close();
}

// Discover what versions the running code ships.
const ALL_CURRENT_VERSIONS = discoverMigrations(getMigrationsDir()).map((m) => m.version);
// Pick a boundary we can test "partial" restores with.
const FIRST_VERSION = ALL_CURRENT_VERSIONS[0];
const LAST_VERSION = ALL_CURRENT_VERSIONS[ALL_CURRENT_VERSIONS.length - 1];

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("SQLite restore from prior schema version (clean environment)", () => {
  let dbPaths: string[] = [];
  let dbs: Database.Database[] = [];

  beforeEach(() => {
    resetRecordedRestoreOutcome();
  });

  afterEach(() => {
    for (const db of dbs) {
      try {
        db.close();
      } catch {
        // already closed
      }
    }
    for (const p of dbPaths) {
      if (fs.existsSync(p)) fs.unlinkSync(p);
    }
    dbs = [];
    dbPaths = [];
    resetRecordedRestoreOutcome();
  });

  function track(db: Database.Database, p: string): Database.Database {
    dbs.push(db);
    dbPaths.push(p);
    return db;
  }

  // ── 1. Restore from a backup taken with only the first migration applied ──

  it("reports transient_delay when restoring a backup that is behind the running code", () => {
    const p = tmpDbPath();
    buildBackupAtVersion(p, [FIRST_VERSION]);
    const db = track(openDb(p), p);

    const signal = getLiveRestoreOutcomeSignal(db);

    expect(signal.outcome).toBe("transient_delay");
    expect(signal.outcomeCode).toBe(SQLITE_RESTORE_OUTCOME_CODES.transient_delay);
    expect(signal.counts.applied).toBe(1);
    expect(signal.counts.expected).toBe(ALL_CURRENT_VERSIONS.length);
    expect(signal.counts.pending).toBe(ALL_CURRENT_VERSIONS.length - 1);
    expect(signal.counts.unknown).toBe(0);
  });

  it("detail for a behind-backup carries counts only — no paths, filenames, or secrets", () => {
    const p = tmpDbPath();
    buildBackupAtVersion(p, [FIRST_VERSION]);
    const db = track(openDb(p), p);

    const { detail } = getLiveRestoreOutcomeSignal(db);

    expect(detail).not.toMatch(/\/|\.sql|streams\.db|secret|schema_migrations/i);
    expect(detail).toMatch(/pending/i);
    expect(detail).toMatch(/\d+/); // mentions the count
  });

  // ── 2. Restore from a backup taken at the current code version ──────────

  it("reports success when restoring a backup that matches the running code exactly", () => {
    const p = tmpDbPath();
    buildBackupAtVersion(p, ALL_CURRENT_VERSIONS);
    const db = track(openDb(p), p);

    const signal = getLiveRestoreOutcomeSignal(db);

    expect(signal.outcome).toBe("success");
    expect(signal.outcomeCode).toBe(SQLITE_RESTORE_OUTCOME_CODES.success);
    expect(signal.counts.pending).toBe(0);
    expect(signal.counts.unknown).toBe(0);
  });

  // ── 3. Restore from a backup taken at a newer code version (blocked) ────

  it("reports blocked when restoring a backup written by a newer build", () => {
    const p = tmpDbPath();
    // Add an unknown future migration version that this build does not know.
    buildBackupAtVersion(p, [...ALL_CURRENT_VERSIONS, 9999]);
    const db = track(openDb(p), p);

    const signal = getLiveRestoreOutcomeSignal(db);

    expect(signal.outcome).toBe("blocked");
    expect(signal.outcomeCode).toBe(SQLITE_RESTORE_OUTCOME_CODES.blocked);
    expect(signal.counts.unknown).toBe(1);
  });

  it("detail for a newer-backup carries owner-action instructions", () => {
    const p = tmpDbPath();
    buildBackupAtVersion(p, [...ALL_CURRENT_VERSIONS, 9999]);
    const db = track(openDb(p), p);

    const { detail } = getLiveRestoreOutcomeSignal(db);

    expect(detail).toMatch(/owner action/i);
    expect(detail).not.toMatch(/\/|\.sql|streams\.db|secret|schema_migrations/i);
  });

  // ── 4. Fresh checkout — no schema_migrations table at all ───────────────

  it("treats a fresh database with no schema_migrations table as transient_delay", () => {
    const p = tmpDbPath();
    // Create an empty database — no tables at all.
    const db = track(openDb(p), p);

    const signal = getLiveRestoreOutcomeSignal(db);

    // All expected migrations are pending; none have been recorded.
    expect(signal.outcome).toBe("transient_delay");
    expect(signal.counts.applied).toBe(0);
    expect(signal.counts.pending).toBe(ALL_CURRENT_VERSIONS.length);
  });

  // ── 5. runMigrations catches a behind-backup up to current code ──────────

  it("runMigrations upgrades a behind-backup to the current schema without error", () => {
    const p = tmpDbPath();
    // Build a backup that only has the first migration applied — full schema
    // tables included so later migrations can run ALTER TABLE.
    const db = track(openDb(p), p);
    const migrationsDir = getMigrationsDir();
    const migrations = discoverMigrations(migrationsDir);

    // Apply only the first migration manually so schema_migrations has one entry.
    db.exec(fs.readFileSync(migrations[0].upPath, "utf-8"));
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version     INTEGER PRIMARY KEY,
        name        TEXT NOT NULL,
        applied_at  INTEGER NOT NULL
      );
    `);
    db.prepare(
      "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
    ).run(migrations[0].version, migrations[0].name, Math.floor(Date.now() / 1000));

    // Confirm the signal before running migrations.
    const before = getLiveRestoreOutcomeSignal(db);
    expect(before.outcome).toBe("transient_delay");

    // Simulate what initDb does: apply pending migrations.
    runMigrations(db);

    // Signal must now be success.
    const after = getLiveRestoreOutcomeSignal(db);
    expect(after.outcome).toBe("success");
    expect(after.counts.pending).toBe(0);
  });

  // ── 6. Prometheus gauge reflects each outcome ────────────────────────────

  it("Prometheus gauge reflects transient_delay for a behind-backup", async () => {
    const p = tmpDbPath();
    buildBackupAtVersion(p, [FIRST_VERSION]);
    const db = track(openDb(p), p);

    const signal = getLiveRestoreOutcomeSignal(db);
    recordRestoreOutcome(signal);
    refreshRestoreMetrics();

    const scraped = await register.metrics();
    const line = scraped.split("\n").find((l) => l.startsWith("sqlite_restore_outcome "));
    expect(line).toBe(
      `sqlite_restore_outcome ${SQLITE_RESTORE_OUTCOME_CODES.transient_delay}`,
    );
  });

  it("Prometheus gauge reflects blocked for a newer-build backup", async () => {
    const p = tmpDbPath();
    buildBackupAtVersion(p, [...ALL_CURRENT_VERSIONS, 9999]);
    const db = track(openDb(p), p);

    const signal = getLiveRestoreOutcomeSignal(db);
    recordRestoreOutcome(signal);
    refreshRestoreMetrics();

    const scraped = await register.metrics();
    const line = scraped.split("\n").find((l) => l.startsWith("sqlite_restore_outcome "));
    expect(line).toBe(
      `sqlite_restore_outcome ${SQLITE_RESTORE_OUTCOME_CODES.blocked}`,
    );
  });

  it("Prometheus gauge reflects success for a current-version backup", async () => {
    const p = tmpDbPath();
    buildBackupAtVersion(p, ALL_CURRENT_VERSIONS);
    const db = track(openDb(p), p);

    const signal = getLiveRestoreOutcomeSignal(db);
    recordRestoreOutcome(signal);
    refreshRestoreMetrics();

    const scraped = await register.metrics();
    const line = scraped.split("\n").find((l) => l.startsWith("sqlite_restore_outcome "));
    expect(line).toBe(
      `sqlite_restore_outcome ${SQLITE_RESTORE_OUTCOME_CODES.success}`,
    );
  });

  // ── 7. Restore at only last known version (single version behind) ────────

  it("reports transient_delay when exactly one migration is pending", () => {
    // All versions except the very last.
    const versionsWithoutLast = ALL_CURRENT_VERSIONS.slice(0, -1);
    if (versionsWithoutLast.length === 0) {
      // Only one migration exists; skip gracefully.
      return;
    }
    const p = tmpDbPath();
    buildBackupAtVersion(p, versionsWithoutLast);
    const db = track(openDb(p), p);

    const signal = getLiveRestoreOutcomeSignal(db);

    expect(signal.outcome).toBe("transient_delay");
    expect(signal.counts.pending).toBe(1);
    expect(signal.counts.unknown).toBe(0);
  });

  // ── 8. recordRestoreOutcome persists the startup snapshot ───────────────

  it("recordRestoreOutcome persists the startup snapshot for the lifetime of the process", () => {
    const p = tmpDbPath();
    // Build a full database with only the first migration applied (tables
    // present so subsequent migrations can run ALTER TABLE successfully).
    const migrationsDir = getMigrationsDir();
    const migrations = discoverMigrations(migrationsDir);
    const db = track(openDb(p), p);

    // Apply first migration's DDL for real so the tables exist.
    db.exec(fs.readFileSync(migrations[0].upPath, "utf-8"));
    db.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version     INTEGER PRIMARY KEY,
        name        TEXT NOT NULL,
        applied_at  INTEGER NOT NULL
      );
    `);
    db.prepare(
      "INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)",
    ).run(migrations[0].version, migrations[0].name, Math.floor(Date.now() / 1000));

    // Capture the restore signal at the point before migrations run.
    const signal = getLiveRestoreOutcomeSignal(db);
    expect(signal.outcome).toBe("transient_delay");
    recordRestoreOutcome(signal);

    // Simulate what startup does: apply pending migrations.
    runMigrations(db);

    // The live signal flips to success once migrations are applied …
    const liveAfter = getLiveRestoreOutcomeSignal(db);
    expect(liveAfter.outcome).toBe("success");

    // … but the recorded startup snapshot stays as transient_delay,
    // reflecting the schema state at the moment the backup was opened.
    expect(getRecordedRestoreOutcome()?.outcome).toBe("transient_delay");
  });
});
