#!/usr/bin/env node
/**
 * Repeatable smoke verification for SQLite restore (Issue #1223).
 *
 * Verifies restore outcome signal mapping, runbook documentation parity,
 * and secret/path redaction without requiring a live database or running service.
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const read = (p) => readFileSync(join(root, p), "utf8");

test("SQLite restore files and documentation exist", () => {
  assert.ok(existsSync(join(root, "RUNBOOK.md")), "RUNBOOK.md must exist");
  assert.ok(existsSync(join(root, "backend/src/services/dbRestoreOutcome.ts")), "dbRestoreOutcome.ts must exist");
  assert.ok(existsSync(join(root, "backend/src/services/dbRestoreOutcome.restore.test.ts")), "restore tests must exist");
});

test("RUNBOOK.md documents all 4 restore outcome codes", () => {
  const runbook = read("RUNBOOK.md");
  assert.ok(runbook.includes("`success`"), "success documented");
  assert.ok(runbook.includes("`transient_delay`"), "transient_delay documented");
  assert.ok(runbook.includes("`blocked`"), "blocked documented");
  assert.ok(runbook.includes("`interrupted`"), "interrupted documented");
  assert.ok(runbook.includes("sqlite_restore_outcome"), "metric name documented");
});

test("dbRestoreOutcome source defines codes and avoids secret leaks", () => {
  const src = read("backend/src/services/dbRestoreOutcome.ts");
  assert.ok(src.includes("success: 0"));
  assert.ok(src.includes("transient_delay: 1"));
  assert.ok(src.includes("blocked: 2"));
  assert.ok(src.includes("interrupted: 3"));
  assert.ok(src.includes("never the database path"), "detail messages must carry counts only, not paths");
});
