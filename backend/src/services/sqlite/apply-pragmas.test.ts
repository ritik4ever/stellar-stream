import Database from "better-sqlite3";
import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import {
  applySqlitePragmas,
  DEFAULT_SQLITE_PRAGMA_SETTINGS,
  readSqlitePragmas,
} from "./apply-pragmas";
import {
  SQLITE_BUSY_TIMEOUT_MS,
  SQLITE_CACHE_SIZE_KIB,
  SqliteConnectionRole,
} from "./constants";

function tempDbPath(): string {
  return path.join(
    os.tmpdir(),
    `stellar-stream-pragmas-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
  );
}

describe("applySqlitePragmas", () => {
  const paths: string[] = [];

  afterEach(() => {
    for (const filePath of paths) {
      for (const suffix of ["", "-wal", "-shm"]) {
        try {
          fs.unlinkSync(filePath + suffix);
        } catch {}
      }
    }
    paths.length = 0;
  });

  it("enables WAL, busy timeout, and tuned cache on a writer connection", () => {
    const filePath = tempDbPath();
    paths.push(filePath);
    const db = new Database(filePath);
    const applied = applySqlitePragmas(db);

    expect(applied.journalMode).toBe("wal");
    expect(applied.busyTimeoutMs).toBe(SQLITE_BUSY_TIMEOUT_MS);
    expect(applied.cacheSize).toBe(SQLITE_CACHE_SIZE_KIB);

    db.close();
  });

  it("applies busy timeout and cache size on a reader without requiring journal writes", () => {
    const filePath = tempDbPath();
    paths.push(filePath);
    const writer = new Database(filePath);
    applySqlitePragmas(writer, DEFAULT_SQLITE_PRAGMA_SETTINGS, SqliteConnectionRole.Writer);
    const reader = new Database(filePath, { readonly: true });
    const applied = applySqlitePragmas(
      reader,
      DEFAULT_SQLITE_PRAGMA_SETTINGS,
      SqliteConnectionRole.Reader,
    );

    expect(applied.journalMode).toBe("wal");
    expect(applied.busyTimeoutMs).toBe(SQLITE_BUSY_TIMEOUT_MS);
    expect(applied.cacheSize).toBe(SQLITE_CACHE_SIZE_KIB);
    reader.close();
    writer.close();
  });

  it("reads back the same pragma snapshot after apply", () => {
    const filePath = tempDbPath();
    paths.push(filePath);
    const db = new Database(filePath);
    const applied = applySqlitePragmas(db);
    expect(readSqlitePragmas(db)).toEqual(applied);
    db.close();
  });
});
