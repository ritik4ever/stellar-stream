#!/usr/bin/env node
/**
 * Validate Frontend CI workflow configuration and outcome observability (Issues #1192, #1193).
 *
 * Verifies:
 * 1. .github/workflows/frontend-ci.yml triggers on frontend path changes.
 * 2. Node.js version and caching strategy match frontend dependencies.
 * 3. Distinguishes outcomes (SUCCESS, TRANSIENT_TIMEOUT, BLOCKED) for browser test timeouts.
 * 4. Links transient timeouts to owner remediation steps in RUNBOOK.md.
 * 5. Secret redaction prevents token and credential leakage.
 *
 * Run via:
 *   node scripts/check-frontend-ci.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const CREDENTIAL_LEAK_PATTERNS = [
  /ghp_[a-zA-Z0-9]{20,}/g,
  /github_pat_[a-zA-Z0-9_]{22,}/g,
  /S[A-Z0-9]{55}/g,
  /BEGIN (?:RSA|EC|PRIVATE) KEY/g,
  /(?:password|secret|api_key|secret_key|private_key)\s*[:=]\s*["']?[^\s,"']+/gi,
];

export function redactSecrets(input) {
  if (typeof input !== "string") return String(input);
  let sanitized = input;
  for (const pattern of CREDENTIAL_LEAK_PATTERNS) {
    sanitized = sanitized.replace(pattern, (match) => {
      if (match.startsWith("S") && match.length === 56) {
        return "[REDACTED_STELLAR_SECRET]";
      }
      return "[REDACTED_CREDENTIAL]";
    });
  }
  return sanitized;
}

export function classifyFrontendCiOutcome({ exitCode, stdout = "", stderr = "" }) {
  const combined = `${stdout}\n${stderr}`;
  if (exitCode === 0) {
    return {
      status: "SUCCESS",
      retryable: false,
      remediation: null,
      message: "Frontend CI completed all checks and builds successfully.",
    };
  }

  const timeoutMatch = /(?:timeout|timed out|exceeded timeout|test timed out)/i.test(combined);
  if (timeoutMatch) {
    return {
      status: "TRANSIENT_TIMEOUT",
      retryable: true,
      remediation: "See RUNBOOK.md #frontend-ci-browser-test-timeout: verify runner resources and retry job",
      message: "Browser or component test timed out during headless execution.",
    };
  }

  return {
    status: "BLOCKED",
    retryable: false,
    remediation: "Inspect compilation/linting errors in frontend/ directory",
    message: "Frontend CI encountered deterministic build or type error.",
  };
}

export function validateFrontendCiConfig(baseDir = root) {
  const results = [];
  function check(name, ok, detail = "") {
    results.push({ name, ok, detail: redactSecrets(detail) });
  }

  const workflowPath = join(baseDir, ".github/workflows/frontend-ci.yml");
  const runbookPath = join(baseDir, "RUNBOOK.md");

  if (!existsSync(workflowPath)) {
    check("frontend-ci.yml workflow file exists", false, "file missing");
    return { ok: false, results, failures: results.filter((r) => !r.ok) };
  }
  check("frontend-ci.yml workflow file exists", true);

  const workflow = readFileSync(workflowPath, "utf8");

  // Check 1: Workflow triggers on frontend changes
  check(
    "frontend-ci.yml triggers on frontend/** paths",
    workflow.includes("paths:") && workflow.includes("'frontend/**'"),
    "paths filter configured"
  );

  // Check 2: Setup Node cache configuration
  check(
    "frontend-ci.yml configures Node caching",
    workflow.includes("cache: 'npm'") || workflow.includes('cache: "npm"'),
    "npm cache enabled"
  );

  // Check 3: Essential frontend build stages
  check(
    "frontend-ci.yml includes type check and build steps",
    workflow.includes("tsc --noEmit") && workflow.includes("npm run build"),
    "type check and build steps configured"
  );

  // Check 4: Runbook references browser test timeouts
  if (existsSync(runbookPath)) {
    const runbook = readFileSync(runbookPath, "utf8");
    check(
      "RUNBOOK.md documents Frontend CI and browser timeout recovery",
      runbook.includes("Frontend CI") && runbook.includes("timeout"),
      "runbook owner actions present"
    );
  } else {
    check("RUNBOOK.md exists", false, "file missing");
  }

  // Check 5: Zero credentials in workflow
  const hasSecret = CREDENTIAL_LEAK_PATTERNS.some((p) => p.test(workflow));
  check(
    "frontend-ci.yml is free of credentials and secrets",
    !hasSecret,
    hasSecret ? "Credential leak found" : "clean"
  );

  const failures = results.filter((r) => !r.ok);
  return {
    ok: failures.length === 0,
    results,
    failures,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { ok, results, failures } = validateFrontendCiConfig();
  console.log("=== StellarStream Frontend CI Verification ===");
  for (const r of results) {
    console.log(`${r.ok ? "PASS" : "FAIL"}: ${r.name} ${r.detail ? `(${r.detail})` : ""}`);
  }
  if (!ok) {
    console.error(`\nFailed with ${failures.length} issue(s).`);
    process.exit(1);
  }
  console.log("\nAll Frontend CI checks PASSED successfully.");
}
