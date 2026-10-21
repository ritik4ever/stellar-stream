import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { validateOpenApiResponses, redactSecrets, hasStatusResponse } from "./check-openapi-responses.mjs";

describe("OpenAPI Responses and Error Model Verification Suite (Issues #1119-#1123)", () => {
  for (const statusCode of [400, 404, 409]) {
    for (const quote of ['"', "'", ""]) {
      it(`recognizes response ${statusCode} with ${quote || "no"} quotes`, () => {
        const source = `responses: { ${quote}${statusCode}${quote} : {} }`;
        assert.equal(hasStatusResponse(source, statusCode), true);
        assert.equal(hasStatusResponse(source.replace(String(statusCode), `1${statusCode}`), statusCode), false);
      });
    }
  }

  it("redacts secrets properly without leaking private keys", () => {
    const raw = "password: mySecretToken123 with key: SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA";
    const cleaned = redactSecrets(raw);
    assert.ok(!cleaned.includes("mySecretToken123"));
    assert.ok(!cleaned.includes("SAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA"));
    assert.ok(cleaned.includes("[REDACTED"));
  });

  it("validates current repository OpenAPI spec and backend error architecture", () => {
    const report = validateOpenApiResponses();
    if (!report.ok) {
      console.error("OpenAPI Validation Failures:", report.failures);
    }
    assert.equal(report.ok, true, "OpenAPI verification should pass with zero failures");
    assert.ok(report.results.length >= 6, "Should evaluate all required checks");
  });
});
