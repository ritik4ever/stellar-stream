import fs from "fs";
import os from "os";
import path from "path";
import { Worker } from "worker_threads";
import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_SQLITE_PRAGMA_SETTINGS, readSqlitePragmas } from "./apply-pragmas";
import { SqliteConnectionPool, isFileBackedSqlitePath } from "./connection-pool";
import {
  SQLITE_BUSY_TIMEOUT_MS,
  SQLITE_CACHE_SIZE_KIB,
} from "./constants";

function tempDbPath(): string {
  return path.join(
    os.tmpdir(),
    `stellar-stream-pool-${Date.now()}-${Math.random().toString(36).slice(2)}.db`,
  );
}

function cleanupDb(filePath: string): void {
  for (const suffix of ["", "-wal", "-shm"]) {
    try {
      fs.unlinkSync(filePath + suffix);
    } catch {}
  }
}

describe("SqliteConnectionPool", () => {
  let dbPath: string;
  let pool: SqliteConnectionPool | undefined;

  afterEach(() => {
    pool?.close();
    pool = undefined;
    if (dbPath) {
      cleanupDb(dbPath);
    }
  });

  it("treats file paths as file-backed and memory paths as not", () => {
    expect(isFileBackedSqlitePath("/tmp/streams.db")).toBe(true);
    expect(isFileBackedSqlitePath(":memory:")).toBe(false);
  });

  it("opens a writer in WAL mode with busy timeout and cache size", () => {
    dbPath = tempDbPath();
    pool = new SqliteConnectionPool({ filePath: dbPath });
    const pragmas = readSqlitePragmas(pool.getWriter());

    expect(pragmas.journalMode).toBe("wal");
    expect(pragmas.busyTimeoutMs).toBe(SQLITE_BUSY_TIMEOUT_MS);
    expect(pragmas.cacheSize).toBe(SQLITE_CACHE_SIZE_KIB);
  });

  it("serves a distinct readonly reader so reads can proceed during writes", () => {
    dbPath = tempDbPath();
    pool = new SqliteConnectionPool({ filePath: dbPath, readPoolSize: 1 });
    const writer = pool.getWriter();
    const reader = pool.getReader();

    expect(reader).not.toBe(writer);
    expect(readSqlitePragmas(reader).journalMode).toBe("wal");
    expect(readSqlitePragmas(reader).busyTimeoutMs).toBe(SQLITE_BUSY_TIMEOUT_MS);

    writer.exec("CREATE TABLE items (id INTEGER PRIMARY KEY, value TEXT)");
    writer.exec("INSERT INTO items (value) VALUES ('before')");

    writer.exec("BEGIN IMMEDIATE");
    writer.exec("UPDATE items SET value = 'during' WHERE id = 1");

    const snapshot = reader.prepare("SELECT value FROM items WHERE id = 1").get() as {
      value: string;
    };
    expect(snapshot.value).toBe("before");

    writer.exec("COMMIT");

    const committed = reader.prepare("SELECT value FROM items WHERE id = 1").get() as {
      value: string;
    };
    expect(committed.value).toBe("during");
  });

  it("waits up to busy_timeout instead of failing immediately on a write lock", async () => {
    dbPath = tempDbPath();
    pool = new SqliteConnectionPool({
      filePath: dbPath,
      readPoolSize: 0,
      pragmas: DEFAULT_SQLITE_PRAGMA_SETTINGS,
    });
    pool.getWriter().exec("CREATE TABLE locks (id INTEGER PRIMARY KEY)");
    pool.close();
    pool = undefined;

    const holderCode = `
      const { parentPort, workerData } = require("worker_threads");
      const Database = require("better-sqlite3");
      const db = new Database(workerData.dbPath);
      db.pragma("journal_mode = WAL");
      db.pragma("busy_timeout = 5000");
      db.exec("BEGIN EXCLUSIVE");
      parentPort.postMessage("locked");
      setTimeout(() => {
        db.exec("COMMIT");
        db.close();
        parentPort.postMessage("released");
      }, 200);
    `;

    const worker = new Worker(holderCode, {
      eval: true,
      workerData: { dbPath },
    });

    await new Promise<void>((resolve, reject) => {
      worker.once("message", (msg: string) => {
        if (msg === "locked") {
          resolve();
          return;
        }
        reject(new Error(`Unexpected worker message: ${msg}`));
      });
      worker.once("error", reject);
    });

    const contender = new SqliteConnectionPool({ filePath: dbPath, readPoolSize: 0 });
    const started = Date.now();
    try {
      expect(() => {
        contender.getWriter().exec("INSERT INTO locks DEFAULT VALUES");
      }).not.toThrow();
      const elapsed = Date.now() - started;
      expect(elapsed).toBeGreaterThanOrEqual(150);
      expect(elapsed).toBeLessThan(SQLITE_BUSY_TIMEOUT_MS);
    } finally {
      contender.close();
      await worker.terminate();
    }
  });
});
