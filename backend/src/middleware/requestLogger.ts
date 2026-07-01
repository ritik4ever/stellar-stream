import { Request, Response, NextFunction } from "express";
import crypto from "crypto";
import { logger } from "../logger";
import { runWithCorrelation } from "../correlationContext";

declare global {
  namespace Express {
    interface Request {
      requestId?: string; // Unique ID for log correlation (backward compat)
      correlationId?: string; // Correlation ID for distributed tracing
    }
  }
}

function extractHeaderValue(
  req: Request,
  headerName: string,
): string | undefined {
  const headerValue = req.headers[headerName];
  if (Array.isArray(headerValue)) {
    return headerValue[0];
  }
  if (typeof headerValue === "string") {
    return headerValue;
  }
  return undefined;
}

function isValidId(id: string): boolean {
  return /^[a-zA-Z0-9-]{1,128}$/.test(id);
}

export function requestLogger(req: Request, res: Response, next: NextFunction) {
  // Accept X-Correlation-ID first, then X-Request-ID, then generate UUID
  let correlationId =
    extractHeaderValue(req, "x-correlation-id") ??
    extractHeaderValue(req, "x-request-id");

  if (!correlationId || !isValidId(correlationId)) {
    correlationId = crypto.randomUUID();
  }

  req.correlationId = correlationId;
  // Keep requestId for backward compatibility
  req.requestId = correlationId;

  // Set response headers
  res.setHeader("X-Correlation-ID", correlationId);
  res.setHeader("X-Request-ID", correlationId);

  const start = Date.now();

  // Run the rest of the request lifecycle within the correlation context
  // The logger's log formatter automatically injects correlation_id from AsyncLocalStorage
  runWithCorrelation(correlationId, () => {
    res.on("finish", () => {
      const durationMs = Date.now() - start;

      const logEntry = {
        correlation_id: correlationId,
        method: req.method,
        route: req.originalUrl,
        statusCode: res.statusCode,
        durationMs,
      };

      const message = "request completed";
      if (res.statusCode >= 500) {
        logger.error(logEntry, message);
      } else if (res.statusCode >= 400) {
        logger.warn(logEntry, message);
      } else {
        logger.info(logEntry, message);
      }
    });

    next();
  });
}
