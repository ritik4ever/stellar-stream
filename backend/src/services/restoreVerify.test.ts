/**
 * Tests for the post-restore verifier (issue #1221).
 *
 * Covers the situations the issue names — restore from a prior point in time
 * (schema behind code) and a schema version differing from the code (both
 * directions) — plus the healthy path and corrupt/missing files. Every failure
 * must be a useful, non-sensitive error, and the verifier must never write
 * (no partial rollout).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import fs from "fs";
import path from "path";
import os from "os";
import Database from "better-sqlite3";

// Freeze "this build's" migrations at the repo's real migration set
// (001–004) so the verifier's expectation is deterministic even if upstream
// adds migrations later.
vi.mock("./migrations", () => ({
  discoverMigrations: () => [
    { version: 1, name: "initial_schema", upPath: "", downPath: "" },
    { version: 2, name: "add_paused_duration", upPath: "", downPath: "" },
    { version: 3, name: "add_metadata", upPath: "", downPath: "" },
    { version: 4, name: "webhook_dead_letters_columns", upPath: "", downPath: "" },
  ],
  getMigrationsDir: () => "/mocked/migrations",
}));

import { verifyRestore } from "./restoreVerify";

let dir: string;
let dbPath: string;

beforeEach(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), "restore-verify-"));
  dbPath = path.join(dir, "streams.db");
});

afterEach(() => {
  fs.rmSync(dir, { recursive: true, force: true });
});

/** Builds a database with the given migration versions applied and data rows. */
function makeDb(
  versions: number[],
  opts: { streams?: number; events?: number; cursor?: number; noCursorTable?: boolean } = {}
): void {
  const db = new Database(dbPath);
  db.exec(
    `CREATE TABLE schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at INTEGER NOT NULL)`
  );
  const insert = db.prepare(
    `INSERT INTO schema_migrations (version, name, applied_at) VALUES (?, ?, ?)`
  );
  for (const v of versions) insert.run(v, `migration_${v}`, 0);

  db.exec(`CREATE TABLE streams (id TEXT PRIMARY KEY, sender TEXT NOT NULL, recipient TEXT NOT NULL)`);
  db.exec(`CREATE TABLE stream_events (id INTEGER PRIMARY KEY AUTOINCREMENT, stream_id TEXT NOT NULL, event_type TEXT NOT NULL)`);
  if (!opts.noCursorTable) {
    db.exec(`CREATE TABLE indexer_cursor (id INTEGER PRIMARY KEY CHECK (id = 1), last_ledger_sequence INTEGER NOT NULL)`);
    if (opts.cursor !== undefined) {
      db.prepare(`INSERT INTO indexer_cursor (id, last_ledger_sequence) VALUES (1, ?)`).run(opts.cursor);
    }
  }

  for (let i = 0; i < (opts.streams ?? 0); i++) {
    db.prepare(`INSERT INTO streams (id, sender, recipient) VALUES (?, ?, ?)`).run(`s${i}`, "GS", "GR");
  }
  for (let i = 0; i < (opts.events ?? 0); i++) {
    db.prepare(`INSERT INTO stream_events (stream_id, event_type) VALUES (?, ?)`).run("s0", "claimed");
  }
  db.close();
}

describe("verifyRestore (issue #1221)", () => {
  it("healthy restore: all checks pass and counts are reported", () => {
    makeDb([1, 2, 3, 4], { streams: 4, events: 21, cursor: 5678 });

    const result = verifyRestore(dbPath);
    expect(result.ok).toBe(true);
    const byName = Object.fromEntries(result.checks.map((c) => [c.name, c]));
    expect(byName.integrity_check.ok).toBe(true);
    expect(byName.schema_version.detail).toContain("4 of 4");
    expect(byName.row_counts.detail).toContain("streams=4");
    expect(byName.row_counts.detail).toContain("stream_events=21");
    expect(byName.indexer_cursor.detail).toContain("5678");
  });

  it("restore from a prior point in time (schema behind code): fails with pending count", () => {
    // An old backup predating migrations 3 and 4.
    makeDb([1, 2], { streams: 1, cursor: 1 });

    const result = verifyRestore(dbPath);
    expect(result.ok).toBe(false);
    const failed = result.checks.find((c) => c.name === "schema_version");
    expect(failed?.ok).toBe(false);
    expect(failed?.detail).toContain("transient_delay");
    expect(failed?.detail).toContain("behind the running code: 2 of 4");
  });

  it("schema ahead of code: fails blocked and names the owner action", () => {
    // A backup from a NEWER build (versions 5 and 6 unknown to this one).
    makeDb([1, 2, 3, 4, 5, 6], { streams: 1, cursor: 1 });

    const result = verifyRestore(dbPath);
    expect(result.ok).toBe(false);
    const failed = result.checks.find((c) => c.name === "schema_version");
    expect(failed?.detail).toContain("blocked");
    expect(failed?.detail).toContain("ahead of the running code: 2");
  });

  it("missing indexer cursor row: fails instead of letting the poller rewind", () => {
    makeDb([1, 2, 3, 4], { streams: 1, noCursorTable: true });

    const result = verifyRestore(dbPath);
    expect(result.ok).toBe(false);
    const failed = result.checks.find((c) => c.name === "indexer_cursor");
    expect(failed?.detail).toContain("indexer cursor row missing");
  });

  it("corrupt file: fails integrity check with a non-sensitive error", () => {
    fs.writeFileSync(dbPath, "this is not a sqlite database at all", "utf8");

    const result = verifyRestore(dbPath);
    expect(result.ok).toBe(false);
    const failed = result.checks.find((c) => !c.ok);
    expect(["sqlite_open", "integrity_check"]).toContain(failed?.name);
    // Non-sensitive: no schema internals leak into the message.
    expect(failed?.detail).not.toMatch(/CREATE TABLE/i);
  });

  it("missing file: fails immediately with the path", () => {
    const result = verifyRestore(path.join(dir, "does-not-exist.db"));
    expect(result.ok).toBe(false);
    expect(result.checks[0]).toMatchObject({ name: "file_exists", ok: false });
  });
});
