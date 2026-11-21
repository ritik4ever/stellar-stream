import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  validateFrontendCiConfig,
  classifyFrontendCiOutcome,
  redactSecrets,
} from "./check-frontend-ci.mjs";

describe("Frontend CI Verification & Outcome Observability Suite (Issues #1192, #1193)", () => {
  it("redacts secrets without leaking credentials", () => {
    const raw = "token: ghp_1234567890123456789012345 with seed SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const cleaned = redactSecrets(raw);
    assert.ok(!cleaned.includes("ghp_1234567890123456789012345"));
    assert.ok(!cleaned.includes("SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"));
    assert.ok(cleaned.includes("[REDACTED_CREDENTIAL]"));
    assert.ok(cleaned.includes("[REDACTED_STELLAR_SECRET]"));
  });

  it("distinguishes SUCCESS, TRANSIENT_TIMEOUT, and BLOCKED outcomes", () => {
    const success = classifyFrontendCiOutcome({ exitCode: 0, stdout: "all tests passed" });
    assert.equal(success.status, "SUCCESS");
    assert.equal(success.retryable, false);

    const timeout = classifyFrontendCiOutcome({
      exitCode: 1,
      stderr: "Error: browser test timed out after 30000ms",
    });
    assert.equal(timeout.status, "TRANSIENT_TIMEOUT");
    assert.equal(timeout.retryable, true);
    assert.ok(timeout.remediation.includes("RUNBOOK.md"));

    const blocked = classifyFrontendCiOutcome({
      exitCode: 1,
      stderr: "Type error: Property 'x' does not exist on type 'Stream'",
    });
    assert.equal(blocked.status, "BLOCKED");
    assert.equal(blocked.retryable, false);
  });

  it("validates repository Frontend CI workflow and runbook", () => {
    const report = validateFrontendCiConfig();
    if (!report.ok) {
      console.error("Failures:", report.failures);
    }
    assert.equal(report.ok, true, "Frontend CI configuration must pass all checks");
  });
});
