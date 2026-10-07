#!/usr/bin/env node
/**
 * Validate the Backend CI workflow against the backend toolchain (Issue #1184).
 *
 * Backend CI previously failed before any check ran because the workflow mixed
 * up its cache manager and pinned a Node version the toolchain no longer
 * supports. This guard reads the workflow and the backend lockfile and fails if
 * the two drift apart, so the same class of defect cannot silently return.
 *
 * Exits non-zero with a `FAIL:` line per problem. Run via:
 *   node scripts/check-backend-ci.mjs
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const results = [];

function check(name, ok, detail = "") {
  results.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}: ${name}${detail ? ` — ${detail}` : ""}`);
}

/**
 * Lowest Node major supported by the backend toolchain. `vitest@5` requires
 * `^22.12.0 || ^24.0.0 || >=26.0.0` and `better-sqlite3@13` requires `>=22`, so
 * anything below 22 cannot install or run the test suite.
 */
const MIN_NODE_MAJOR = 22;
const SUPPORTED_CACHES = new Set(["npm", "yarn", "pnpm"]);

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

const workflowPath = join(root, ".github/workflows/backend-ci.yml");
const workflow = readFileSync(workflowPath, "utf8");

// 1. Cache manager must be one setup-node understands. The original workflow
//    said `nmp`, which setup-node rejects before the first step can run.
const cacheMatch = workflow.match(/cache:\s*['"]([^'"]+)['"]/);
check(
  "backend-ci.yml uses a supported setup-node cache",
  Boolean(cacheMatch) && SUPPORTED_CACHES.has(cacheMatch[1]),
  cacheMatch ? `cache=${cacheMatch[1]}` : "no cache field found",
);

// 2. Node version must satisfy the backend engine requirements.
const nodeMatch = workflow.match(/node-version:\s*['"]?(\d+)/);
const nodeMajor = nodeMatch ? Number(nodeMatch[1]) : Number.NaN;
check(
  `backend-ci.yml pins Node >= ${MIN_NODE_MAJOR}`,
  Number.isFinite(nodeMajor) && nodeMajor >= MIN_NODE_MAJOR,
  nodeMatch ? `node-version=${nodeMajor}` : "no node-version field found",
);

// 3. Manifest and lockfile must agree, otherwise `npm ci` fails with EUSAGE in
//    a clean checkout. This mirrors scripts/verify-dependencies.mjs.
try {
  const manifest = readJson(join(root, "backend/package.json"));
  const lock = readJson(join(root, "backend/package-lock.json"));
  if (lock.lockfileVersion !== 3 || !lock.packages?.[""]) {
    throw new Error("expected an npm v3 lockfile with a root package entry");
  }
  const lockedRoot = lock.packages[""];
  let drift = "";
  for (const section of [
    "dependencies",
    "devDependencies",
    "optionalDependencies",
  ]) {
    const declared = manifest[section] ?? {};
    const locked = lockedRoot[section] ?? {};
    for (const name of new Set([
      ...Object.keys(declared),
      ...Object.keys(locked),
    ])) {
      if (declared[name] !== locked[name]) {
        drift = `${section}.${name}: manifest=${declared[name] ?? "absent"} lock=${locked[name] ?? "absent"}`;
        break;
      }
    }
    if (drift) break;
  }
  check("backend manifest and lockfile are in sync", drift === "", drift);
} catch (error) {
  check("backend manifest and lockfile are in sync", false, error.message);
}

const failures = results.filter((result) => !result.ok);
console.log(
  `\nBackend CI configuration: ${failures.length === 0 ? "PASS" : "FAIL"} (${failures.length} problem${failures.length === 1 ? "" : "s"})`,
);
process.exitCode = failures.length === 0 ? 0 : 1;
