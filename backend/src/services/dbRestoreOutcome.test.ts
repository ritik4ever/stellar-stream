import Database from "better-sqlite3";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SQLITE_RESTORE_OUTCOME_CODES,
  classifyRestoreOutcome,
  getLiveRestoreOutcomeSignal,
  getRecordedRestoreOutcome,
  readAppliedSchemaVersions,
  readRestoreSnapshot,
  recordRestoreOutcome,
  refreshRestoreMetrics,
  resetRecordedRestoreOutcome,
} from "./dbRestoreOutcome";
import { discoverMigrations, getMigrationsDir } from "./migrations";
import { register } from "./metrics";

const CURRENT_VERSIONS = discoverMigrations(getMigrationsDir()).map(
  (migration) => migration.version,
);

function createTempDbPath(): string {
  return path.join(
    os.tmpdir(),
    `stellar-stream-restore-outcome-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
  );
}

describe("classifyRestoreOutcome", () => {
  it("reports success when the database schema matches the running code", () => {
    const signal = classifyRestoreOutcome({
      appliedVersions: [1, 2, 3, 4],
      expectedVersions: [1, 2, 3, 4],
    });

    expect(signal.outcome).toBe("success");
    expect(signal.outcomeCode).toBe(SQLITE_RESTORE_OUTCOME_CODES.success);
    expect(signal.counts).toEqual({
      applied: 4,
      expected: 4,
      pending: 0,
      unknown: 0,
    });
  });

  it("reports transient_delay when the database is behind the running code", () => {
    const signal = classifyRestoreOutcome({
      appliedVersions: [1, 2],
      expectedVersions: [1, 2, 3, 4],
    });

    expect(signal.outcome).toBe("transient_delay");
    expect(signal.outcomeCode).toBe(SQLITE_RESTORE_OUTCOME_CODES.transient_delay);
    expect(signal.counts).toEqual({
      applied: 2,
      expected: 4,
      pending: 2,
      unknown: 0,
    });
    expect(signal.detail).toMatch(/pending/i);
  });

  it("reports blocked when the database is ahead of the running code", () => {
    const signal = classifyRestoreOutcome({
      appliedVersions: [1, 2, 3, 4, 9],
      expectedVersions: [1, 2, 3, 4],
    });

    expect(signal.outcome).toBe("blocked");
    expect(signal.outcomeCode).toBe(SQLITE_RESTORE_OUTCOME_CODES.blocked);
    expect(signal.counts.unknown).toBe(1);
    expect(signal.detail).toMatch(/owner action/i);
  });

  it("reports interrupted when the database integrity check fails", () => {
    const signal = classifyRestoreOutcome({
      appliedVersions: [1, 2],
      expectedVersions: [1, 2, 3, 4],
      integrityOk: false,
    });

    expect(signal.outcome).toBe("interrupted");
    expect(signal.outcomeCode).toBe(SQLITE_RESTORE_OUTCOME_CODES.interrupted);
    expect(signal.detail).toMatch(/interrupted before completion|corrupted/i);
    expect(signal.detail).toMatch(/owner action/i);
  });

  it("prefers blocked over transient_delay when the database is both ahead and behind", () => {
    const signal = classifyRestoreOutcome({
      appliedVersions: [1, 5],
      expectedVersions: [1, 2],
    });

    expect(signal.counts.pending).toBe(1);
    expect(signal.counts.unknown).toBe(1);
    expect(signal.outcome).toBe("blocked");
  });

  it("de-duplicates and sorts versions so the counts stay stable", () => {
    const signal = classifyRestoreOutcome({
      appliedVersions: [3, 1, 1, 2],
      expectedVersions: [2, 1, 1],
    });

    expect(signal.counts).toEqual({
      applied: 3,
      expected: 2,
      pending: 0,
      unknown: 1,
    });
  });

  it("never leaks paths, migration files or secrets in the detail", () => {
    const blocked = classifyRestoreOutcome({
      appliedVersions: [1, 9],
      expectedVersions: [1],
    });
    const transient = classifyRestoreOutcome({
      appliedVersions: [1],
      expectedVersions: [1, 2],
    });
    const success = classifyRestoreOutcome({
      appliedVersions: [1],
      expectedVersions: [1],
    });

    for (const signal of [blocked, transient, success]) {
      expect(signal.detail).not.toMatch(/(?:\/|\.sql|streams\.db|secret|schema_migrations)/i);
    }
  });
});

describe("readRestoreSnapshot", () => {
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

  function openDbWithApplied(versions: number[]): void {
    dbPath = createTempDbPath();
    db = new Database(dbPath);
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
    for (const version of versions) {
      insert.run(version, `migration_${version}`, 0);
    }
  }

  it("treats a missing schema_migrations table as a normal transient state", () => {
    dbPath = createTempDbPath();
    db = new Database(dbPath);

    expect(readAppliedSchemaVersions(db)).toEqual([]);

    const signal = getLiveRestoreOutcomeSignal(db);
    expect(signal.outcome).toBe("transient_delay");
    expect(signal.counts.pending).toBe(CURRENT_VERSIONS.length);
  });

  it("reports success for a restored database at the running code version", () => {
    openDbWithApplied(CURRENT_VERSIONS);

    const snapshot = readRestoreSnapshot(db);
    expect(snapshot.expectedVersions).toEqual(CURRENT_VERSIONS);
    expect(snapshot.appliedVersions).toEqual(CURRENT_VERSIONS);

    expect(getLiveRestoreOutcomeSignal(db).outcome).toBe("success");
  });

  it("reports transient_delay for a snapshot taken before the running code", () => {
    openDbWithApplied([CURRENT_VERSIONS[0]]);

    const signal = getLiveRestoreOutcomeSignal(db);
    expect(signal.outcome).toBe("transient_delay");
    expect(signal.counts.pending).toBe(CURRENT_VERSIONS.length - 1);
  });

  it("reports blocked for a snapshot written by a newer build", () => {
    openDbWithApplied([...CURRENT_VERSIONS, 9999]);

    const signal = getLiveRestoreOutcomeSignal(db);
    expect(signal.outcome).toBe("blocked");
    expect(signal.counts.unknown).toBe(1);
  });
});

describe("recordRestoreOutcome", () => {
  beforeEach(() => {
    resetRecordedRestoreOutcome();
  });

  afterEach(() => {
    resetRecordedRestoreOutcome();
  });

  it("stores and returns the most recently recorded outcome", () => {
    expect(getRecordedRestoreOutcome()).toBeNull();

    const signal = classifyRestoreOutcome({
      appliedVersions: [1],
      expectedVersions: [1, 2],
    });
    expect(recordRestoreOutcome(signal)).toEqual(signal);
    expect(getRecordedRestoreOutcome()).toEqual(signal);
  });

  it("publishes the recorded outcome code to Prometheus", async () => {
    expect(refreshRestoreMetrics()).toBeNull();

    recordRestoreOutcome(
      classifyRestoreOutcome({
        appliedVersions: [1, 2, 3, 4, 9],
        expectedVersions: [1, 2, 3, 4],
      }),
    );
    refreshRestoreMetrics();

    const scraped = await register.metrics();
    expect(scraped).toContain("sqlite_restore_outcome");

    const sample = scraped
      .split("\n")
      .find((line) => line.startsWith("sqlite_restore_outcome "));
    expect(sample).toBe(
      `sqlite_restore_outcome ${SQLITE_RESTORE_OUTCOME_CODES.blocked}`,
    );
  });
});
