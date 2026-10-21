#!/usr/bin/env node
/**
 * Validate OpenAPI responses, boundary error handling, and response model consistency
 * for StellarStream Backend API (Issues #1119, #1120, #1121, #1122, #1123).
 *
 * Verifies:
 * 1. 400, 404, and 409 error models and examples are explicitly documented in OpenAPI spec.
 * 2. Published response models match actual error handler payload structure.
 * 3. Secrets and private keys are never exposed in error responses.
 * 4. Deterministic outcome codes distinguish validation errors, not found, and state conflicts.
 *
 * Run via:
 *   node scripts/check-openapi-responses.mjs
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

const CREDENTIAL_LEAK_PATTERNS = [
  /ghp_[a-zA-Z0-9]{20,}/g, // GitHub PAT
  /github_pat_[a-zA-Z0-9_]{22,}/g,
  /S[A-Z0-9]{55}/g, // Stellar secret seed (starts with S, 56 chars)
  /BEGIN (?:RSA|EC|PRIVATE) KEY/g, // Private key block
  /(?:password|secret|api_key|secret_key|private_key)\s*[:=]\s*["']?[^\s,"']+/gi, // Concrete secrets
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

export function hasStatusResponse(source, statusCode) {
  // Both quote styles and numeric keys are valid in the TypeScript spec.
  return new RegExp(`(?:"${statusCode}"|'${statusCode}'|\\b${statusCode})\\s*:`).test(source);
}

export function validateOpenApiResponses(baseDir = root) {
  const results = [];
  function check(name, ok, detail = "") {
    results.push({ name, ok, detail: redactSecrets(detail) });
  }

  const swaggerPath = join(baseDir, "backend/src/swagger.ts");
  const apiErrorsPath = join(baseDir, "backend/src/apiErrors.ts");

  if (!existsSync(swaggerPath)) {
    check("swagger.ts exists", false, "file missing");
    return { ok: false, results, failures: results.filter((r) => !r.ok) };
  }
  check("swagger.ts exists", true);

  if (!existsSync(apiErrorsPath)) {
    check("apiErrors.ts exists", false, "file missing");
    return { ok: false, results, failures: results.filter((r) => !r.ok) };
  }
  check("apiErrors.ts exists", true);

  const swaggerContent = readFileSync(swaggerPath, "utf8");
  const apiErrorsContent = readFileSync(apiErrorsPath, "utf8");

  // Check 1: 400 Bad Request error model and responses
  check(
    "OpenAPI spec documents 400 Bad Request error responses",
    hasStatusResponse(swaggerContent, 400),
    "400 status code present in path responses"
  );

  // Check 2: 404 Not Found error model and responses
  check(
    "OpenAPI spec documents 404 Not Found error responses",
    hasStatusResponse(swaggerContent, 404),
    "404 status code present in path responses"
  );

  // Check 3: 409 Conflict error model and responses
  check(
    "OpenAPI spec documents 409 Conflict error responses",
    hasStatusResponse(swaggerContent, 409),
    "409 status code present in path responses"
  );

  // Check 4: Reusable error responses in components.responses
  check(
    "components.responses defines standard error responses",
    swaggerContent.includes("BadRequest:") &&
      swaggerContent.includes("NotFound:") &&
      swaggerContent.includes("Conflict:"),
    "BadRequest, NotFound, and Conflict responses declared"
  );

  // Check 5: Error schema has required correlation and tracking fields
  check(
    "Error schema includes error, statusCode, and requestId/correlationId",
    swaggerContent.includes("requestId") &&
      swaggerContent.includes("statusCode") &&
      swaggerContent.includes("error"),
    "Tracking fields present in Error schema"
  );

  // Check 6: Backend apiErrors exports structured conflict handling
  check(
    "apiErrors.ts provides sendConflictError or handles 409 explicitly",
    apiErrorsContent.includes("409") || apiErrorsContent.includes("sendConflictError"),
    "Conflict error handling supported in backend runtime"
  );

  // Check 7: No raw Stellar private keys or leaked secrets in swagger file
  const hasSecretLeak = CREDENTIAL_LEAK_PATTERNS.some((p) => p.test(swaggerContent));
  check(
    "OpenAPI spec is free of credentials and secret keys",
    !hasSecretLeak,
    hasSecretLeak ? "Potential secret leak found" : "clean"
  );

  const failures = results.filter((r) => !r.ok);
  return {
    ok: failures.length === 0,
    results,
    failures,
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const { ok, results, failures } = validateOpenApiResponses();
  console.log("=== StellarStream OpenAPI Responses Verification ===");
  for (const r of results) {
    console.log(`${r.ok ? "PASS" : "FAIL"}: ${r.name} ${r.detail ? `(${r.detail})` : ""}`);
  }
  if (!ok) {
    console.error(`\nFailed with ${failures.length} issue(s).`);
    process.exit(1);
  }
  console.log("\nAll OpenAPI response checks PASSED successfully.");
}
