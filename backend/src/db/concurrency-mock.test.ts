import Database from "better-sqlite3";
import fs from "fs";
import os from "os";
import path from "path";
import { Worker } from "worker_threads";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { runMigrations } from "../services/migrations";

function createTempDbPath(): string {
  return path.join(
    os.tmpdir(),
    `stellar-stream-concurrency-${Date.now()}-${Math.random().toString(36).slice(2)}.db`
  );
}

describe("SQLite WAL mode and concurrent read/write safety", () => {
  let dbPath: string;

  beforeEach(() => {
    dbPath = createTempDbPath();
  });

  afterEach(() => {
    if (dbPath) {
      try {
        fs.unlinkSync(dbPath);
      } catch {}
      try {
        fs.unlinkSync(dbPath + "-wal");
      } catch {}
      try {
        fs.unlinkSync(dbPath + "-shm");
      } catch {}
    }
  });

  it("verifies PRAGMA journal_mode = wal on connection", () => {
    const db = new Database(dbPath);
    db.pragma("journal_mode = WAL");
    const result = db.pragma("journal_mode");
    db.close();
    expect(result).toEqual([{ journal_mode: "wal" }]);
  });

  it("does not throw SQLITE_BUSY during concurrent read and write", () => {
    const writerDb = new Database(dbPath);
    writerDb.pragma("journal_mode = WAL");
    writerDb.pragma("busy_timeout = 5000");
    writerDb.pragma("synchronous = NORMAL");
    runMigrations(writerDb);

    const readerDb = new Database(dbPath);
    readerDb.pragma("journal_mode = WAL");
    readerDb.pragma("busy_timeout = 5000");

    try {
      writerDb
        .prepare(
          `INSERT INTO streams (id, sender, recipient, asset_code, total_amount, duration_seconds, start_at, created_at)
           VALUES (@id, @sender, @recipient, @asset, @amount, @duration, @start, @created)`
        )
        .run({
          id: "concurrent-stream",
          sender: "GABCDEF123",
          recipient: "GHIJKL456",
          asset: "USDC",
          amount: 1000,
          duration: 3600,
          start: 1000000,
          created: 1000000,
        });

      const writeTx = writerDb.transaction(() => {
        writerDb
          .prepare("UPDATE streams SET total_amount = 2000 WHERE id = @id")
          .run({ id: "concurrent-stream" });

        writerDb
          .prepare("UPDATE streams SET duration_seconds = 7200 WHERE id = @id")
          .run({ id: "concurrent-stream" });

        writerDb
          .prepare("UPDATE streams SET canceled_at = 3000000 WHERE id = @id")
          .run({ id: "concurrent-stream" });
      });

      expect(writeTx).not.toThrow();

      const row = readerDb
        .prepare("SELECT * FROM streams WHERE id = ?")
        .get("concurrent-stream") as any;
      expect(row).toBeDefined();
      expect(row.total_amount).toBe(2000);
      expect(row.duration_seconds).toBe(7200);
      expect(row.canceled_at).toBe(3000000);

      const readerReadDuringTx = readerDb
        .prepare("SELECT * FROM streams WHERE id = ?")
        .get("concurrent-stream") as any;
      expect(readerReadDuringTx).toBeDefined();
    } finally {
      writerDb.close();
      readerDb.close();
    }
  });

  it("returns consistent data when reader reads during active write transaction", () => {
    const writerDb = new Database(dbPath);
    writerDb.pragma("journal_mode = WAL");
    writerDb.pragma("busy_timeout = 5000");
    runMigrations(writerDb);

    const readerDb = new Database(dbPath);
    readerDb.pragma("journal_mode = WAL");
    readerDb.pragma("busy_timeout = 5000");

    try {
      writerDb
        .prepare(
          `INSERT INTO streams (id, sender, recipient, asset_code, total_amount, duration_seconds, start_at, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
        )
        .run("consistency-stream", "GSENDER", "GRECIP", "USDC", 1000, 3600, 1000000, 1000000);

      const tx = writerDb.transaction(() => {
        writerDb
          .prepare("UPDATE streams SET total_amount = 2000 WHERE id = ?")
          .run("consistency-stream");

        const snapshot = readerDb
          .prepare("SELECT * FROM streams WHERE id = ?")
          .get("consistency-stream") as any;
        expect(snapshot).toBeTruthy();
        expect(snapshot.total_amount === 1000 || snapshot.total_amount === 2000).toBe(true);
        expect(snapshot.duration_seconds).toBe(3600);

        writerDb
          .prepare("UPDATE streams SET duration_seconds = 7200 WHERE id = ?")
          .run("consistency-stream");
      });

      expect(tx).not.toThrow();

      const finalRow = readerDb
        .prepare("SELECT * FROM streams WHERE id = ?")
        .get("consistency-stream") as any;
      expect(finalRow.total_amount).toBe(2000);
      expect(finalRow.duration_seconds).toBe(7200);
    } finally {
      writerDb.close();
      readerDb.close();
    }
  });

  it("handles true concurrent read/write via worker threads without SQLITE_BUSY", async () => {
    const setupDb = new Database(dbPath);
    setupDb.pragma("journal_mode = WAL");
    setupDb.pragma("busy_timeout = 5000");
    runMigrations(setupDb);

    setupDb
      .prepare(
        `INSERT INTO streams (id, sender, recipient, asset_code, total_amount, duration_seconds, start_at, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
      )
      .run("worker-stream", "GWRITER", "GREADER", "USDC", 5000, 3600, 1000000, 1000000);
    setupDb.close();

    const workerCode = `
      const { parentPort } = require("worker_threads");
      const Database = require("better-sqlite3");
      const dbPath = ${JSON.stringify(dbPath)};
      const role = ${JSON.stringify("writer")};

      try {
        const db = new Database(dbPath);
        db.pragma("journal_mode = WAL");
        db.pragma("busy_timeout = 5000");

        const ITERATIONS = 25;
        for (let i = 0; i < ITERATIONS; i++) {
          db.transaction(() => {
            db.prepare("UPDATE streams SET total_amount = ? WHERE id = 'worker-stream'").run(5000 + i * 500);
            db.prepare("UPDATE streams SET duration_seconds = ? WHERE id = 'worker-stream'").run(i % 2 === 0 ? 3600 : 7200);
          })();
        }

        db.close();
        parentPort.postMessage({ success: true });
      } catch (err) {
        parentPort.postMessage({ error: err instanceof Error ? err.message : String(err) });
      }
    `;

    const readerCode = `
      const { parentPort } = require("worker_threads");
      const Database = require("better-sqlite3");
      const dbPath = ${JSON.stringify(dbPath)};
      const role = ${JSON.stringify("reader")};

      try {
        const db = new Database(dbPath);
        db.pragma("journal_mode = WAL");
        db.pragma("busy_timeout = 5000");

        const ITERATIONS = 25;
        for (let i = 0; i < ITERATIONS; i++) {
          const row = db.prepare("SELECT * FROM streams WHERE id = 'worker-stream'").get();
          if (row) {
            if (row.total_amount < 5000 || row.total_amount % 500 !== 0) {
              throw new Error("Data inconsistency: invalid total_amount " + row.total_amount);
            }
            if (row.total_amount === 5000 && row.duration_seconds !== 3600) {
              throw new Error("Data inconsistency: initial row has wrong duration " + row.duration_seconds);
            }
          }
        }

        db.close();
        parentPort.postMessage({ success: true });
      } catch (err) {
        parentPort.postMessage({ error: err instanceof Error ? err.message : String(err) });
      }
    `;

    const runWorker = (code: string, timeout = 10000): Promise<void> =>
      new Promise((resolve, reject) => {
        const worker = new Worker(code, { eval: true });
        const timer = setTimeout(() => {
          worker.terminate();
          reject(new Error("Worker timed out"));
        }, timeout);

        worker.on("message", (msg: any) => {
          clearTimeout(timer);
          if (msg.error) {
            reject(new Error(msg.error));
          } else {
            resolve();
          }
        });
        worker.on("error", (err) => {
          clearTimeout(timer);
          reject(err);
        });
      });

    const results = await Promise.allSettled([
      runWorker(workerCode),
      runWorker(readerCode),
    ]);

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      if (result.status === "rejected") {
        const errMsg = result.reason?.message || String(result.reason);
        console.error(`Worker ${i} (${i === 0 ? "writer" : "reader"}) failed:`, errMsg);
        expect(errMsg).not.toMatch(/SQLITE_BUSY|BUSY|locked/i);
      }
    }

    for (let i = 0; i < results.length; i++) {
      const result = results[i];
      expect(result.status, `Worker ${i} should be fulfilled`).toBe("fulfilled");
    }

    const verifyDb = new Database(dbPath);
    verifyDb.pragma("journal_mode = WAL");
    const row = verifyDb
      .prepare("SELECT * FROM streams WHERE id = ?")
      .get("worker-stream") as any;
    verifyDb.close();

    expect(row).toBeDefined();
    expect(row.id).toBe("worker-stream");
    expect(row.total_amount).toBeGreaterThanOrEqual(5000);
    expect(row.total_amount).toBeLessThanOrEqual(5000 + 24 * 500);
    expect([3600, 7200]).toContain(row.duration_seconds);
    expect(row.sender).toBe("GWRITER");
    expect(row.recipient).toBe("GREADER");
  });
});
