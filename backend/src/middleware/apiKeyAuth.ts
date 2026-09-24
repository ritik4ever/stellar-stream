import { Request, Response, NextFunction } from "express";
import { verifyApiKey, ApiKeyRecord } from "../services/apiKeyService";
import { sendApiError } from "../apiErrors";

declare global {
  namespace Express {
    interface Request {
      apiKey?: ApiKeyRecord;
    }
  }
}

export function isMutationMethod(method: string): boolean {
  const upper = method.toUpperCase();
  return upper === "POST" || upper === "PUT" || upper === "PATCH" || upper === "DELETE";
}

/**
 * Strict middleware enforcing valid X-API-Key header and scope restrictions.
 */
export function apiKeyAuth(req: Request, res: Response, next: NextFunction) {
  const apiKeyHeader = req.header("X-API-Key") || req.header("x-api-key");

  if (!apiKeyHeader) {
    sendApiError(req, res, 401, "Missing X-API-Key header.", {
      code: "UNAUTHORIZED",
    });
    return;
  }

  const keyRecord = verifyApiKey(apiKeyHeader);
  if (!keyRecord) {
    sendApiError(req, res, 401, "Invalid or expired API key.", {
      code: "UNAUTHORIZED",
    });
    return;
  }

  if (keyRecord.scope === "read-only" && isMutationMethod(req.method)) {
    sendApiError(req, res, 403, "Read-only API key cannot perform mutations.", {
      code: "FORBIDDEN",
    });
    return;
  }

  req.apiKey = keyRecord;
  (req as any).user = {
    accountId: `api_key:${keyRecord.id}`,
    scope: keyRecord.scope,
  };

  next();
}

/**
 * Optional API key middleware: if X-API-Key header is present, validates it and enforces scope checks.
 * If X-API-Key header is absent, allows request to proceed (for fallback to JWT or public endpoints).
 */
export function optionalApiKeyAuth(req: Request, res: Response, next: NextFunction) {
  const apiKeyHeader = req.header("X-API-Key") || req.header("x-api-key");

  if (apiKeyHeader) {
    const keyRecord = verifyApiKey(apiKeyHeader);
    if (!keyRecord) {
      sendApiError(req, res, 401, "Invalid or expired API key.", {
        code: "UNAUTHORIZED",
      });
      return;
    }

    if (keyRecord.scope === "read-only" && isMutationMethod(req.method)) {
      sendApiError(req, res, 403, "Read-only API key cannot perform mutations.", {
        code: "FORBIDDEN",
      });
      return;
    }

    req.apiKey = keyRecord;
    (req as any).user = {
      accountId: `api_key:${keyRecord.id}`,
      scope: keyRecord.scope,
    };
  }

  next();
}
