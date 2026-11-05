import { timingSafeEqual } from "node:crypto";
import { Request, Response, NextFunction } from "express";
import { sendApiError } from "../apiErrors";
import { logger } from "../logger";

export interface AdminAuthorizedCaller {
  role: "admin";
  accountId: "admin";
  isAdmin: true;
}

export const ADMIN_CALLER: Readonly<AdminAuthorizedCaller> = Object.freeze({
  role: "admin",
  accountId: "admin",
  isAdmin: true,
});

const MALFORMED_KEY_PATTERN = /[\s,\x00-\x1f\x7f]/;

function hasDuplicateHeader(req: Request, headerName: string): boolean {
  const raw = req.header(headerName);
  if (Array.isArray(raw)) {
    return true;
  }

  const rawHeaders = (req as { rawHeaders?: unknown }).rawHeaders;
  if (!Array.isArray(rawHeaders)) {
    return false;
  }

  const target = headerName.toLowerCase();
  let count = 0;
  for (let i = 0; i < rawHeaders.length; i += 2) {
    if (typeof rawHeaders[i] === "string" && rawHeaders[i].toLowerCase() === target) {
      count += 1;
      if (count > 1) {
        return true;
      }
    }
  }

  return false;
}

function isMalformedKeyFormat(key: string): boolean {
  return MALFORMED_KEY_PATTERN.test(key);
}

/**
 * Validates the Admin API key from `X-Admin-Key` (and optionally `req.body.apiKey`
 * for the admin token-exchange endpoint) and records the authorized admin caller
 * on `req.user` when valid.
 */
function evaluateAdminApiKey(
  req: Request,
  res: Response,
  options: { allowBodyKey?: boolean } | undefined,
  deny: (req: Request, res: Response, status: number, message: string, extra: { code: AdminAuthOutcomeCode }) => void,
): boolean {
  delete (req as { user?: unknown }).user;

  const configuredRaw = process.env.ADMIN_API_KEY;
  const configured = typeof configuredRaw === "string" ? configuredRaw.trim() : "";

  if (configured.length === 0) {
    deny(req, res, 401, "Admin API key is not configured on this server.", {
      code: "ADMIN_KEY_NOT_CONFIGURED",
    });
    return false;
  }

  // Reject repeated X-Admin-Key headers whether surfaced as string[] by mocks
  // or folded from multiple entries in Node's req.rawHeaders.
  if (hasDuplicateHeader(req, "X-Admin-Key")) {
    deny(req, res, 401, "Ambiguous X-Admin-Key header (multiple values).", {
      code: "ADMIN_KEY_MALFORMED",
    });
    return false;
  }

  const rawHeader = req.header("X-Admin-Key");
  const hasHeader = rawHeader !== undefined;

  const allowBodyKey = options?.allowBodyKey === true;
  const bodyObj =
    allowBodyKey &&
    req.body !== null &&
    typeof req.body === "object" &&
    !Array.isArray(req.body)
      ? (req.body as Record<string, unknown>)
      : undefined;
  const hasBodyKey =
    bodyObj !== undefined &&
    Object.prototype.hasOwnProperty.call(bodyObj, "apiKey") &&
    bodyObj.apiKey !== undefined;

  if (!hasHeader && !hasBodyKey) {
    deny(
      req,
      res,
      401,
      allowBodyKey ? "Missing Admin API key." : "Missing X-Admin-Key header.",
      {
        code: "ADMIN_KEY_MISSING",
      },
    );
    return false;
  }

  let trimmedHeader: string | undefined;
  if (hasHeader) {
    if (typeof rawHeader !== "string") {
      deny(req, res, 401, "Malformed X-Admin-Key header.", {
        code: "ADMIN_KEY_MALFORMED",
      });
      return false;
    }

    trimmedHeader = rawHeader.trim();
    if (trimmedHeader.length === 0) {
      deny(req, res, 401, "Empty X-Admin-Key header.", {
        code: "ADMIN_KEY_MALFORMED",
      });
      return false;
    }

    if (isMalformedKeyFormat(trimmedHeader)) {
      deny(req, res, 401, "Malformed X-Admin-Key header.", {
        code: "ADMIN_KEY_MALFORMED",
      });
      return false;
    }
  }

  let trimmedBody: string | undefined;
  if (hasBodyKey) {
    const rawBodyKey = bodyObj!.apiKey;
    if (typeof rawBodyKey !== "string") {
      deny(req, res, 401, "Malformed Admin API key.", {
        code: "ADMIN_KEY_MALFORMED",
      });
      return false;
    }

    trimmedBody = rawBodyKey.trim();
    if (trimmedBody.length === 0) {
      deny(req, res, 401, "Empty Admin API key.", {
        code: "ADMIN_KEY_MALFORMED",
      });
      return false;
    }

    if (isMalformedKeyFormat(trimmedBody)) {
      deny(req, res, 401, "Malformed Admin API key.", {
        code: "ADMIN_KEY_MALFORMED",
      });
      return false;
    }
  }

  if (trimmedHeader !== undefined && trimmedBody !== undefined && trimmedHeader !== trimmedBody) {
    deny(req, res, 401, "Conflicting Admin API key in header and body.", {
      code: "ADMIN_KEY_MALFORMED",
    });
    return false;
  }

  const key = (trimmedHeader ?? trimmedBody)!;

  if (key !== configured) {
    deny(req, res, 401, "Invalid Admin API key.", {
      code: "ADMIN_KEY_INVALID",
    });
    return false;
  }

  (req as { user?: AdminAuthorizedCaller }).user = { ...ADMIN_CALLER };
  return true;
}

export type AdminAuthOutcomeCode =
  | "ADMIN_KEY_NOT_CONFIGURED"
  | "ADMIN_KEY_MALFORMED"
  | "ADMIN_KEY_MISSING"
  | "ADMIN_KEY_INVALID";

/**
 * Validates the Admin API key from `X-Admin-Key` (and optionally `req.body.apiKey`
 * for the admin token-exchange endpoint) and records the authorized admin caller
 * on `req.user` when valid.
 *
 * Emits one structured `admin_auth` log line per attempt with the outcome,
 * rejection code, latency, and request/correlation/stream IDs so operators can
 * tell an expected rejection (missing/malformed/invalid key, `warn`) from a
 * server misconfiguration (`ADMIN_KEY_NOT_CONFIGURED`, `error`) and from success
 * (`info`), including requests racing a key rotation. The key value, its length,
 * and any derivative of it are never logged.
 */
export function authorizeAdminApiKey(
  req: Request,
  res: Response,
  options?: { allowBodyKey?: boolean },
): boolean {
  const startedAt = process.hrtime.bigint();
  let rejectionCode: AdminAuthOutcomeCode | undefined;

  const deny = (
    r: Request,
    s: Response,
    status: number,
    message: string,
    extra: { code: AdminAuthOutcomeCode },
  ) => {
    rejectionCode = extra.code;
    sendApiError(r, s, status, message, extra);
  };

  const authorized = evaluateAdminApiKey(req, res, options, deny);
  const latencyMs = Number(process.hrtime.bigint() - startedAt) / 1e6;
  const streamId = (req.params as Record<string, string> | undefined)?.id;
  const fields = {
    event: "admin_auth",
    outcome: authorized ? "authorized" : "rejected",
    code: authorized ? undefined : rejectionCode,
    latencyMs,
    method: req.method,
    path: req.path,
    requestId: req.requestId,
    correlationId: req.correlationId,
    streamId,
  };
  if (authorized) {
    logger.info(fields, "admin API key authorized");
  } else if (rejectionCode === "ADMIN_KEY_NOT_CONFIGURED") {
    logger.error(fields, "admin API key rejected: server misconfigured");
  } else {
    logger.warn(fields, "admin API key rejected");
  }
  return authorized;
}
/**
 * Admin API key authentication middleware.
 *
 * Boundary contract (see #1109 and README "Admin API Key Boundaries"):
 *
 *   - Header `X-Admin-Key` missing           -> 401 ADMIN_KEY_MISSING
 *   - Header empty / whitespace / not string -> 401 ADMIN_KEY_MALFORMED
 *   - `ADMIN_API_KEY` env unset              -> 401 ADMIN_KEY_NOT_CONFIGURED
 *   - Header present, does not match env     -> 401 ADMIN_KEY_INVALID
 *   - Header present, matches env            -> sets req.user and calls next()
 *
 * The env var is read on every request, not cached at startup. Rotating the
 * key therefore requires a process restart; any request already inside the
 * handler before the restart completes under the key value that was in
 * `process.env` when it entered. No key is retained past restart.
 */
export function adminAuth(req: Request, res: Response, next: NextFunction) {
  if (!authorizeAdminApiKey(req, res)) {
    return;
  }

  next();
}
