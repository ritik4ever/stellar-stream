import fs from "fs";
import os from "os";
import path from "path";
import { afterEach, describe, expect, it } from "vitest";
import { closeDb, getDb, getReadDb, initDb } from "../db";
import { readSqlitePragmas } from "./apply-pragmas";
import { SQLITE_BUSY_TIMEOUT_MS, SQLITE_CACHE_SIZE_KIB } from "./constants";

function tempDbPath(): string {
  return path.join(
    os.tmpdir(),
    `stellar-stream-initdb-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
  );
}

describe("initDb SQLite pragmas", () => {
  let dbPath: string;
  let previousDbPath: string | undefined;

  afterEach(() => {
    closeDb();
    if (previousDbPath === undefined) {
      delete process.env.DB_PATH;
    } else {
      process.env.DB_PATH = previousDbPath;
    }
    if (dbPath) {
      for (const suffix of ["", "-wal", "-shm"]) {
        try {
          fs.unlinkSync(dbPath + suffix);
        } catch {}
      }
    }
  });

  it("applies WAL, busy_timeout, and cache_size through initDb", () => {
    previousDbPath = process.env.DB_PATH;
    dbPath = tempDbPath();
    process.env.DB_PATH = dbPath;
    delete process.env.DATABASE_URL;

    initDb();
    const pragmas = readSqlitePragmas(getDb());

    expect(pragmas.journalMode).toBe("wal");
    expect(pragmas.busyTimeoutMs).toBe(SQLITE_BUSY_TIMEOUT_MS);
    expect(pragmas.cacheSize).toBe(SQLITE_CACHE_SIZE_KIB);
    expect(getReadDb()).not.toBe(getDb());
  });
});
