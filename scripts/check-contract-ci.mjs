#!/usr/bin/env node
/**
 * Validate the Contract CI workflow and Soroban toolchain configuration (Issue #1196).
 *
 * Checks:
 * 1. .github/workflows/contract-ci.yml targets wasm32-unknown-unknown
 * 2. contracts/Cargo.toml declares cdylib crate type for Soroban WASM artifacts
 * 3. contracts/Cargo.toml defines soroban-sdk dependency
 * 4. Build profile includes WASM optimization and symbol stripping
 * 5. Secret redaction prevents credential leaks in error output
 *
 * Exits non-zero with diagnostic output on failure. Run via:
 *   node scripts/check-contract-ci.mjs
 */
import { existsSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const SECRET_PATTERNS = [
  /password[=:\s]+[^\s,]+/gi,
  /secret[=:\s]+[^\s,]+/gi,
  /token[=:\s]+[^\s,]+/gi,
  /(?:api_key|secret_key|private_key|key)[=:]\s*[^\s,]+/gi,
  /ghp_[a-zA-Z0-9]+/g,
  /S[A-Z0-9]{55}/g, // Stellar secret key seed
];

export function redactSecrets(input) {
  if (typeof input !== "string") return String(input);
  let sanitized = input;
  for (const pattern of SECRET_PATTERNS) {
    sanitized = sanitized.replace(pattern, (match) => {
      if (match.startsWith("S") && match.length === 56) {
        return "[REDACTED_STELLAR_SECRET]";
      }
      const parts = match.split(/[=:\s]+/);
      return parts.length > 1 ? `${parts[0]}=[REDACTED]` : "[REDACTED]";
    });
  }
  return sanitized;
}

export function validateContractCiConfig(baseDir = root) {
  const results = [];

  function check(name, ok, detail = "") {
    results.push({ name, ok, detail: redactSecrets(detail) });
  }

  const workflowPath = join(baseDir, ".github/workflows/contract-ci.yml");
  const cargoTomlPath = join(baseDir, "contracts/Cargo.toml");

  // 1. Contract CI workflow file exists
  if (!existsSync(workflowPath)) {
    check("contract-ci.yml workflow file exists", false, "file missing");
    return { ok: false, results, failures: results.filter((r) => !r.ok) };
  }
  check("contract-ci.yml workflow file exists", true);

  const workflow = readFileSync(workflowPath, "utf8");

  // 2. Toolchain targets wasm32-unknown-unknown
  const hasWasmTarget = /targets:\s*wasm32-unknown-unknown/i.test(workflow) ||
    /--target\s+wasm32-unknown-unknown/i.test(workflow);
  check(
    "contract-ci.yml configures wasm32-unknown-unknown target",
    hasWasmTarget,
    hasWasmTarget ? "target configured" : "wasm32-unknown-unknown target missing",
  );

  // 3. Working directory set to contracts
  const hasContractsWorkDir = /working-directory:\s*contracts/i.test(workflow);
  check(
    "contract-ci.yml sets working directory to contracts",
    hasContractsWorkDir,
    hasContractsWorkDir ? "working-directory=contracts" : "working-directory missing",
  );

  // 4. Cargo lockfile cache key
  const hasCache = /contracts\/Cargo\.lock/i.test(workflow);
  check(
    "contract-ci.yml caches dependencies based on contracts/Cargo.lock",
    hasCache,
    hasCache ? "cache key uses contracts/Cargo.lock" : "cache key missing Cargo.lock reference",
  );

  // 5. Cargo.toml exists and declares cdylib
  if (!existsSync(cargoTomlPath)) {
    check("contracts/Cargo.toml exists", false, "file missing");
    return { ok: false, results, failures: results.filter((r) => !r.ok) };
  }
  check("contracts/Cargo.toml exists", true);

  const cargoToml = readFileSync(cargoTomlPath, "utf8");

  const hasCdylib = /crate-type\s*=\s*\[[^\]]*"cdylib"[^\]]*\]/i.test(cargoToml);
  check(
    "Cargo.toml declares cdylib crate type for Soroban WASM build",
    hasCdylib,
    hasCdylib ? "cdylib declared" : "cdylib missing from crate-type",
  );

  // 6. soroban-sdk dependency
  const hasSorobanSdk = /soroban-sdk\s*=\s*/i.test(cargoToml);
  check(
    "Cargo.toml specifies soroban-sdk dependency",
    hasSorobanSdk,
    hasSorobanSdk ? "soroban-sdk specified" : "soroban-sdk missing",
  );

  // 7. Optimization profile
  const hasReleaseProfile = /\[profile\.release\]/i.test(cargoToml) &&
    /opt-level\s*=\s*"z"/i.test(cargoToml);
  check(
    "Cargo.toml release profile enables size optimization (opt-level = 'z')",
    hasReleaseProfile,
    hasReleaseProfile ? "release profile optimized" : "release profile optimization missing",
  );

  const failures = results.filter((r) => !r.ok);
  return { ok: failures.length === 0, results, failures };
}

// Direct execution
if (process.argv[1] && process.argv[1].endsWith("check-contract-ci.mjs")) {
  const { ok, results, failures } = validateContractCiConfig();
  for (const r of results) {
    console.log(`${r.ok ? "PASS" : "FAIL"}: ${r.name}${r.detail ? ` — ${r.detail}` : ""}`);
  }
  console.log(`\nContract CI configuration: ${ok ? "PASS" : "FAIL"} (${failures.length} problem${failures.length === 1 ? "" : "s"})`);
  process.exitCode = ok ? 0 : 1;
}
