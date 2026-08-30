import { logger } from "../logger";

export class SorobanSubmitError extends Error {
  public readonly statusCode?: number;
  public readonly retryAfter: number;

  constructor(message: string, statusCode?: number, retryAfter = 10) {
    super(message);
    this.name = "SorobanSubmitError";
    this.statusCode = statusCode;
    this.retryAfter = retryAfter;
  }
}

const RETRY_DELAYS_MS = [1000, 2000, 4000];

function extractStatusCode(err: unknown): number | undefined {
  if (err && typeof err === "object") {
    const e = err as Record<string, unknown>;
    const response = e["response"] as Record<string, unknown> | undefined;
    return (e["status"] ?? response?.["status"] ?? e["statusCode"]) as number | undefined;
  }
  return undefined;
}

function isRetryableError(err: unknown): boolean {
  const statusCode = extractStatusCode(err);

  if (statusCode !== undefined && statusCode >= 400 && statusCode < 500) {
    return false;
  }

  if (statusCode === 503 || statusCode === 504) {
    return true;
  }

  const msg = String(
    err && typeof err === "object" ? (err as Record<string, unknown>).message ?? err : err,
  ).toLowerCase();

  return (
    msg.includes("network") ||
    msg.includes("timeout") ||
    msg.includes("econnrefused") ||
    msg.includes("econnreset") ||
    msg.includes("fetch failed") ||
    msg.includes("etimedout")
  );
}

export async function retryWithBackoff<T>(
  fn: () => Promise<T>,
  maxRetries = 3,
): Promise<T> {
  let lastError: unknown;
  const totalAttempts = maxRetries + 1;

  for (let attempt = 1; attempt <= totalAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;

      if (!isRetryableError(err)) {
        throw err;
      }

      if (attempt >= totalAttempts) {
        break;
      }

      const delayMs =
        RETRY_DELAYS_MS[attempt - 1] ??
        RETRY_DELAYS_MS[RETRY_DELAYS_MS.length - 1];

      logger.warn(
        { err, attempt, totalAttempts, delayMs },
        `Soroban submission failed (attempt ${attempt}/${totalAttempts}), retrying in ${delayMs}ms`,
      );

      await new Promise<void>((r) => setTimeout(r, delayMs));
    }
  }

  const statusCode = extractStatusCode(lastError);
  throw new SorobanSubmitError(
    `Soroban transaction submission failed after ${maxRetries} ${maxRetries === 1 ? "retry" : "retries"}: ${
      lastError instanceof Error ? lastError.message : String(lastError)
    }`,
    statusCode,
    10,
  );
}
