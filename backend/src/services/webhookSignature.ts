import { createHmac, timingSafeEqual } from "crypto";

export function computeWebhookSignature(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("hex");
}

export function verifyWebhookSignature(
  payload: string | Buffer,
  signatureHeader: string,
  secret: string,
): boolean {
  const payloadString = typeof payload === "string" ? payload : payload.toString("utf8");

  if (!payloadString.length) {
    return false;
  }

  const [algorithm, signature] = signatureHeader.split("=");
  if (algorithm !== "sha256" || !signature) {
    return false;
  }

  const expectedSignature = computeWebhookSignature(payloadString, secret);

  const providedSignature = Buffer.from(signature, "hex");
  const expectedSignatureBuffer = Buffer.from(expectedSignature, "hex");

  if (providedSignature.length !== expectedSignatureBuffer.length) {
    return false;
  }

  return timingSafeEqual(providedSignature, expectedSignatureBuffer);
}

export function getWebhookHeaders(
  payload: string,
  secret?: string,
): Record<string, string> {
  return {
    "Content-Type": "application/json",
    ...(secret && {
      "X-Webhook-Signature": `sha256=${computeWebhookSignature(payload, secret)}`,
    }),
  };
}
