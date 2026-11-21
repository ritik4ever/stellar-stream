import assert from "node:assert/strict";
import test from "node:test";
import { redactSecrets, validateContractCiConfig } from "./check-contract-ci.mjs";

test("redactSecrets sanitizes sensitive tokens, passwords, and Stellar secret keys", () => {
  const sensitive = "Error: token=ghp_secretToken123456 password=secretPass and seed=SB3VABCDEFGHIJ123456789012345678901234567890123456789012";
  const sanitized = redactSecrets(sensitive);
  assert.ok(!sanitized.includes("ghp_secretToken123456"));
  assert.ok(!sanitized.includes("secretPass"));
  assert.ok(!sanitized.includes("SB3VABCDEFGHIJ123456789012345678901234567890123456789012"));
  assert.ok(sanitized.includes("[REDACTED]"));
  assert.ok(sanitized.includes("[REDACTED_STELLAR_SECRET]"));
});

test("validateContractCiConfig passes on valid repository setup", () => {
  const result = validateContractCiConfig();
  assert.equal(result.ok, true, `Validation failed: ${result.failures.map(f => f.name).join(", ")}`);
  assert.equal(result.failures.length, 0);
  assert.ok(result.results.length >= 7);
});

test("validateContractCiConfig flags missing workflow file gracefully", () => {
  const result = validateContractCiConfig("/tmp/nonexistent-directory-for-testing");
  assert.equal(result.ok, false);
  assert.ok(result.failures.some(f => f.name.includes("workflow file exists")));
});
