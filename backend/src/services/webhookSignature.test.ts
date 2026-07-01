import { readFileSync } from "fs";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { computeWebhookSignature, getWebhookHeaders, verifyWebhookSignature } from "./webhookSignature";

/**
 * SAMPLE VERIFICATION SNIPPET FOR WEBHOOK RECEIVERS:
 * 
 * import { createHmac, timingSafeEqual } from "crypto";
 * 
 * function verifyWebhook(payload: string, signatureHeader: string, secret: string): boolean {
 *   const [algorithm, signature] = signatureHeader.split("=");
 *   if (algorithm !== "sha256") return false;
 * 
 *   const expectedSignature = createHmac("sha256", secret)
 *     .update(payload)
 *     .digest("hex");
 * 
 *   // Use timingSafeEqual to prevent timing attacks
 *   return timingSafeEqual(
 *     Buffer.from(signature, "hex"),
 *     Buffer.from(expectedSignature, "hex")
 *   );
 * }
 */

describe("Webhook Signature Verification", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  const secret = "test-signing-secret-1234567890";
  const payload = JSON.stringify({
    event: "stream.created",
    payload: { id: "stream_123", amount: "100" },
    timestamp: "2026-04-28T12:00:00Z",
  });

  it("should compute signature correctly against a known reference value", () => {
    // Reference value computed with node verify_signature.js
    const expectedHex = "8dd11d06b3e01e9ff284dbeb74e4d4218efc1059b51037df829c2d7c391c453f";
    
    const signature = computeWebhookSignature(payload, secret);
    expect(signature).toBe(expectedHex);
  });

  it("should produce a different signature for a tampered payload", () => {
    const originalSignature = computeWebhookSignature(payload, secret);
    
    const tamperedPayload = payload.replace("100", "1000");
    const tamperedSignature = computeWebhookSignature(tamperedPayload, secret);
    
    expect(tamperedSignature).not.toBe(originalSignature);
  });

  it("should produce a different signature for a different secret", () => {
    const signature1 = computeWebhookSignature(payload, secret);
    const signature2 = computeWebhookSignature(payload, "different-secret");
    
    expect(signature1).not.toBe(signature2);
  });

  it("should reject a tampered payload body", () => {
    const signatureHeader = `sha256=${computeWebhookSignature(payload, secret)}`;
    const tamperedPayload = payload.replace("100", "1000");

    expect(verifyWebhookSignature(tamperedPayload, signatureHeader, secret)).toBe(false);
  });

  it("should reject a signature generated with a different secret", () => {
    const signatureHeader = `sha256=${computeWebhookSignature(payload, secret)}`;

    expect(verifyWebhookSignature(payload, signatureHeader, "different-secret")).toBe(false);
  });

  it("should reject a truncated signature without throwing", () => {
    const truncatedSignature = computeWebhookSignature(payload, secret).slice(0, 32);
    const signatureHeader = `sha256=${truncatedSignature}`;

    expect(() => verifyWebhookSignature(payload, signatureHeader, secret)).not.toThrow();
    expect(verifyWebhookSignature(payload, signatureHeader, secret)).toBe(false);
  });

  it("should reject empty payloads", () => {
    const signatureHeader = `sha256=${computeWebhookSignature(payload, secret)}`;

    expect(verifyWebhookSignature("", signatureHeader, secret)).toBe(false);
    expect(verifyWebhookSignature(Buffer.from(""), signatureHeader, secret)).toBe(false);
  });

  it("should use timingSafeEqual for the final comparison", () => {
    const implementationPath = path.resolve(__dirname, "webhookSignature.ts");
    const source = readFileSync(implementationPath, "utf8");

    expect(source).toContain("timingSafeEqual(");
    expect(source).toContain("return timingSafeEqual(providedSignature, expectedSignatureBuffer);");
  });

  describe("getWebhookHeaders", () => {
    it("should include X-Webhook-Signature header when secret is provided", () => {
      const headers = getWebhookHeaders(payload, secret);
      
      expect(headers).toHaveProperty("Content-Type", "application/json");
      expect(headers).toHaveProperty("X-Webhook-Signature");
      expect(headers["X-Webhook-Signature"]).toMatch(/^sha256=[a-f0-9]{64}$/);
    });

    it("should NOT include X-Webhook-Signature header when secret is NOT provided", () => {
      const headers = getWebhookHeaders(payload, undefined);
      
      expect(headers).toHaveProperty("Content-Type", "application/json");
      expect(headers).not.toHaveProperty("X-Webhook-Signature");
    });
  });
});
