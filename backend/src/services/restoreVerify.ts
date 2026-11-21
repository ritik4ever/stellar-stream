/**
 * Post-restore verification for the SQLite database (issue #1221).
 *
 * Answers, with a clear pass/fail and no partial fixes, whether a restored
 * `streams.db` is safe to serve traffic from — BEFORE the backend is started
 * (startup migrations would silently catch a behind-schema restore up, i.e. a
 * partial rollout; this verifier runs read-only and never repairs):
 *
 *   1. the file exists, opens, and passes SQLite's integrity check,
 *   2. the restored schema matches the migrations shipped with this build —
 *      classified with the same three-outcome vocabulary the live
 *      `sqlite_restore_outcome` signal uses (issue #1261):
 *        - `success`         → serve,
 *        - `transient_delay` → schema behind code (startup would migrate);
 *                              FAIL here so the operator decides deliberately,
 *        - `blocked`         → schema ahead of code; forward-only migrations
 *                              cannot reconcile — do NOT serve,
 *   3. stream/event counts are readable and reported,
 *   4. the indexer cursor exists so the poller resumes, never rewinds.
 *
 * Errors never include file contents, credentials, or user data — only paths,
 * versions, and counts.
 *
 * CLI:  cd backend && npx ts-node --transpile-only src/services/restoreVerify.ts [dbPath]
 * API:  import { verifyRestore } from "./services/restoreVerify";
 */

import fs from "fs";
import path from "path";
import Database from "better-sqlite3";
import { getLiveRestoreOutcomeSignal } from "./dbRestoreOutcome";

export interface RestoreCheck {
  name: string;
  ok: boolean;
  /** Path-level or count-level facts only — never file contents or secrets. */
  detail: string;
}

export interface RestoreVerifyResult {
  ok: boolean;
  checks: RestoreCheck[];
}

function fail(checks: RestoreCheck[], name: string, detail: string): RestoreVerifyResult {
  checks.push({ name, ok: false, detail });
  return { ok: false, checks };
}

/**
 * Verifies a restored SQLite database. Strictly read-only (opens the file
 * readonly and never writes, migrates, or repairs): a failed check means the
 * operator restores again or migrates deliberately — no partial rollout.
 */
export function verifyRestore(dbPath: string): RestoreVerifyResult {
  const checks: RestoreCheck[] = [];

  // 1. File exists and opens as a SQLite database.
  if (!fs.existsSync(dbPath)) {
    return fail(checks, "file_exists", `no database file at ${dbPath}`);
  }
  checks.push({ name: "file_exists", ok: true, detail: dbPath });

  let db: InstanceType<typeof Database>;
  try {
    db = new Database(dbPath, { readonly: true, fileMustExist: true });
  } catch (err) {
    return fail(
      checks,
      "sqlite_open",
      `not a readable SQLite database: ${(err as Error).message}`
    );
  }

  try {
    // 2. Integrity check. SQLite validates lazily, so a non-database file can
    // surface here (SQLITE_NOTADB) rather than at open — treat any sqlite
    // error as a failed integrity check with a non-sensitive message.
    let integrity: string;
    try {
      integrity = (
        db.prepare("PRAGMA integrity_check").get() as { integrity_check: string }
      ).integrity_check;
    } catch (err) {
      return fail(checks, "integrity_check", `sqlite error: ${(err as Error).message}`);
    }
    if (integrity !== "ok") {
      return fail(checks, "integrity_check", `sqlite reports: ${integrity}`);
    }
    checks.push({ name: "integrity_check", ok: true, detail: "ok" });

    // 3. Schema version vs this build — the exact signal class used at
    // runtime (issue #1261), so CLI and live metric always agree.
    const signal = getLiveRestoreOutcomeSignal(db);
    if (signal.outcome !== "success") {
      return fail(
        checks,
        "schema_version",
        `${signal.outcome}: ${signal.detail}`
      );
    }
    checks.push({
      name: "schema_version",
      ok: true,
      detail: signal.detail,
    });

    // 4. Row counts readable and reported (streams + stream_events).
    try {
      const streamCount = (
        db.prepare("SELECT COUNT(*) AS n FROM streams").get() as { n: number }
      ).n;
      const eventCount = (
        db.prepare("SELECT COUNT(*) AS n FROM stream_events").get() as { n: number }
      ).n;
      checks.push({
        name: "row_counts",
        ok: true,
        detail: `streams=${streamCount} stream_events=${eventCount}`,
      });
    } catch (err) {
      return fail(
        checks,
        "row_counts",
        `core tables unreadable: ${(err as Error).message}`
      );
    }

    // 5. Indexer cursor present so the poller resumes from the restored point
    // instead of rewinding or stalling.
    let cursor: { last_ledger_sequence: number } | undefined;
    try {
      cursor = db
        .prepare("SELECT last_ledger_sequence FROM indexer_cursor WHERE id = 1")
        .get() as { last_ledger_sequence: number } | undefined;
    } catch {
      cursor = undefined; // table missing — handled below
    }
    if (!cursor || typeof cursor.last_ledger_sequence !== "number") {
      return fail(
        checks,
        "indexer_cursor",
        "indexer cursor row missing or unreadable — the indexer would stall or rewind; set it to the restore point ledger (see Force Indexer Reconcile) before serving"
      );
    }
    checks.push({
      name: "indexer_cursor",
      ok: true,
      detail: `resumes from ledger ${cursor.last_ledger_sequence}`,
    });

    return { ok: true, checks };
  } finally {
    db.close();
  }
}

// ── CLI entry point ────────────────────────────────────────────────────────
const isCli =
  process.argv[1] && path.basename(process.argv[1]) === "restoreVerify.ts";
if (isCli) {
  const argPath = process.argv[2];
  const target =
    argPath ||
    process.env.DB_PATH ||
    path.join(__dirname, "..", "..", "data", "streams.db");
  const result = verifyRestore(target);
  for (const check of result.checks) {
    process.stdout.write(`${check.ok ? "PASS" : "FAIL"}  ${check.name}: ${check.detail}\n`);
  }
  process.exit(result.ok ? 0 : 1);
}
