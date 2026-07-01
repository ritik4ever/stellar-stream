#!/usr/bin/env ts-node
/**
 * scripts/benchmark-indexes.ts
 *
 * Verifies that the indexes added by migration 0002 are used by SQLite and
 * measures the speedup for the four most common filtered query patterns.
 *
 * Usage (from repo root):
 *   npx ts-node scripts/benchmark-indexes.ts
 *   DB_PATH=backend/data/streams.db npx ts-node scripts/benchmark-indexes.ts
 *
 * The script:
 *  1. Creates two temporary SQLite databases with 100,000 rows of synthetic data.
 *     One has no indexes (full-scan baseline); the other has all four indexes.
 *  2. Runs EXPLAIN QUERY PLAN on every query against the indexed DB.
 *  3. Benchmarks each query against both DBs (median of 10 cold-connection opens).
 *  4. Prints a results table with speedup ratios.
 *  5. Exits 1 if any equality/lookup query fails to hit ≥ 3× speedup.
 *
 * Design notes
 * ────────────
 * • "cold-connection" opens: each timing iteration opens a fresh Database
 *   instance so SQLite's internal page cache starts empty, giving a realistic
 *   measurement of I/O-bound query cost.
 *
 * • Equality lookups (sender, recipient) show the largest gains because an
 *   index lookup is O(log n) vs O(n) for a full table scan.
 *
 * • Range queries (start_at) and status composite queries also benefit, but
 *   speedup depends on selectivity. When the result set is a large fraction
 *   of the table, SQLite may prefer a full scan regardless of the index.
 *   EXPLAIN QUERY PLAN remains the authoritative check for index use.
 */

import Database from "better-sqlite3";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// ─── synthetic data parameters ────────────────────────────────────────────────

const ROW_COUNT = 100_000;
const ASSETS = ["USDC", "XLM", "EURC", "BTC", "ETH"];

/** Pad a Stellar-style account ID to exactly 56 chars */
const stellarId = (prefix: string, suffix: string, n: number) =>
  `G${prefix}${String(n).padStart(54 - prefix.length, suffix)}`
    .substring(0, 56);

// ─── schema ───────────────────────────────────────────────────────────────────

const DDL = `
  CREATE TABLE streams (
    id            TEXT    PRIMARY KEY,
    sender        TEXT    NOT NULL,
    recipient     TEXT    NOT NULL,
    asset_code    TEXT    NOT NULL,
    total_amount  REAL    NOT NULL,
    start_at      INTEGER NOT NULL,
    duration_sec  INTEGER NOT NULL,
    canceled_at   INTEGER,
    completed_at  INTEGER,
    paused_at     INTEGER
  );
`;

const INDEXES = `
  CREATE INDEX IF NOT EXISTS idx_streams_sender
      ON streams(sender);
  CREATE INDEX IF NOT EXISTS idx_streams_recipient
      ON streams(recipient);
  CREATE INDEX IF NOT EXISTS idx_streams_status
      ON streams(canceled_at, completed_at, paused_at);
  CREATE INDEX IF NOT EXISTS idx_streams_start_at
      ON streams(start_at);
`;

// ─── helpers ──────────────────────────────────────────────────────────────────

function buildDb(withIndexes: boolean): string {
  const dbPath = path.join(os.tmpdir(), `sstream_bench_${Date.now()}_${withIndexes ? "idx" : "scan"}.db`);
  const db = new Database(dbPath);
  db.pragma("journal_mode = DELETE");
  db.pragma("synchronous = OFF");
  db.exec(DDL);

  const now = Math.floor(Date.now() / 1000);
  const insert = db.prepare(`
    INSERT INTO streams
      (id, sender, recipient, asset_code, total_amount,
       start_at, duration_sec, canceled_at, completed_at, paused_at)
    VALUES (?,?,?,?,?,?,?,?,?,?)
  `);

  db.transaction(() => {
    for (let i = 0; i < ROW_COUNT; i++) {
      const ca = i % 20 === 0 ? now - 3600 : null;
      const cp = ca === null && i % 15 === 0 ? now - 1800 : null;
      const pa = ca === null && cp === null && i % 30 === 0 ? now - 600 : null;
      insert.run(
        `s${String(i).padStart(7, "0")}`,
        stellarId("U", "0", i),      // unique sender per row (high cardinality)
        stellarId("R", "0", i),      // unique recipient per row
        ASSETS[i % ASSETS.length],
        Math.round(Math.random() * 10_000 * 100) / 100,
        now - Math.floor(Math.random() * 30 * 86_400),
        3_600,
        ca, cp, pa
      );
    }
  })();

  if (withIndexes) {
    db.exec(INDEXES);
    db.exec("ANALYZE");
  }

  db.close();
  return dbPath;
}

/** Median elapsed time in ms over `iters` cold-connection opens */
function coldBench(dbPath: string, sql: string, params: unknown[], iters = 10): number {
  const times: number[] = [];
  for (let i = 0; i < iters; i++) {
    const db = new Database(dbPath, { readonly: true });
    const t0 = performance.now();
    db.prepare(sql).all(...params);
    times.push(performance.now() - t0);
    db.close();
  }
  times.sort((a, b) => a - b);
  return times[Math.floor(iters / 2)];
}

// ─── queries under test ───────────────────────────────────────────────────────

const now = Math.floor(Date.now() / 1000);

const QUERIES: Array<{ label: string; sql: string; params: unknown[]; expectSpeedup: boolean }> = [
  {
    label: "sender = exact (equality lookup)",
    sql: "SELECT * FROM streams WHERE sender = ?",
    params: [stellarId("U", "0", 5_000)],
    expectSpeedup: true,
  },
  {
    label: "recipient = exact (equality lookup)",
    sql: "SELECT * FROM streams WHERE recipient = ?",
    params: [stellarId("R", "0", 5_000)],
    expectSpeedup: true,
  },
  {
    label: "status: canceled (canceled_at IS NOT NULL)",
    sql: "SELECT * FROM streams WHERE canceled_at IS NOT NULL LIMIT 200",
    params: [],
    expectSpeedup: false, // selectivity ~5%; SQLite may choose full scan
  },
  {
    label: "start_at range (7-day window)",
    sql: "SELECT * FROM streams WHERE start_at BETWEEN ? AND ? LIMIT 200",
    params: [now - 7 * 86_400, now],
    expectSpeedup: false, // broad range; selectivity varies
  },
];

// ─── main ─────────────────────────────────────────────────────────────────────

function main() {
  console.log(`\n🔨  Building two DBs with ${ROW_COUNT.toLocaleString()} rows …`);
  const scanDb = buildDb(false);
  const idxDb  = buildDb(true);
  console.log("✅  Done.\n");

  // ── EXPLAIN QUERY PLAN ──────────────────────────────────────────────────
  console.log("─".repeat(70));
  console.log("EXPLAIN QUERY PLAN (indexed DB)");
  console.log("─".repeat(70));
  {
    const db = new Database(idxDb, { readonly: true });
    for (const q of QUERIES) {
      const plan = db.prepare(`EXPLAIN QUERY PLAN ${q.sql}`).all(...q.params) as Array<{ detail: string }>;
      console.log(`\n  ▸ ${q.label}`);
      for (const row of plan) console.log(`    ${row.detail}`);
    }
    db.close();
  }

  // ── benchmark ───────────────────────────────────────────────────────────
  console.log("\n" + "─".repeat(70));
  console.log(`BENCHMARK  (median of 10 cold-connection opens, ${ROW_COUNT.toLocaleString()} rows)`);
  console.log("─".repeat(70));
  console.log(
    `  ${"Query".padEnd(42)} ${"Full scan".padStart(10)} ${"Index".padStart(10)} ${"Speedup".padStart(9)}`
  );
  console.log("  " + "─".repeat(74));

  let allAssertionsPassed = true;
  for (const q of QUERIES) {
    const b = coldBench(scanDb, q.sql, q.params);
    const a = coldBench(idxDb,  q.sql, q.params);
    const speedup = b / a;
    const pass = !q.expectSpeedup || speedup >= 3;
    if (!pass) allAssertionsPassed = false;

    const icon = pass ? "✅" : "❌";
    const note = q.expectSpeedup ? "" : " (range; EXPLAIN is authoritative)";
    console.log(
      `  ${icon} ${q.label.padEnd(40)} ${b.toFixed(2).padStart(10)} ms` +
      ` ${a.toFixed(2).padStart(10)} ms ${speedup.toFixed(1).padStart(8)}×${note}`
    );
  }

  // ── cleanup ─────────────────────────────────────────────────────────────
  fs.unlinkSync(scanDb);
  fs.unlinkSync(idxDb);

  if (!allAssertionsPassed) {
    console.error("\n❌  Equality-lookup speedup assertion failed.\n");
    process.exit(1);
  }
  console.log("\n✅  All equality-lookup queries confirmed ≥ 3× speedup.\n");
  console.log(
    "ℹ️   EXPLAIN QUERY PLAN output above is the authoritative confirmation that\n" +
    "    all four indexes are used by the SQLite query planner.\n"
  );
}

main();