import { Request, Response } from "express";
import { z } from "zod";
import {
  ValidationIssue,
  zodIssuesToErrorMessage,
  zodIssuesToValidationIssues,
} from "./validation/schemas";

export type ApiErrorResponse = {
  error: string;
  statusCode: number;
  requestId?: string;
  correlationId?: string;
  code?: string;
  details?: ValidationIssue[];
};

type ApiErrorOptions = {
  code?: string;
  details?: ValidationIssue[];
};

export function buildApiErrorResponse(
  req: Request,
  statusCode: number,
  error: string,
  options: ApiErrorOptions = {},
): ApiErrorResponse {
  return {
    error,
    statusCode,
    requestId: req.requestId,
    correlationId: req.correlationId,
    code: options.code,
    details: options.details,
  };
}

export function sendApiError(
  req: Request,
  res: Response,
  statusCode: number,
  error: string,
  options: ApiErrorOptions = {},
) {
  return res.status(statusCode).json(buildApiErrorResponse(req, statusCode, error, options));
}

export function sendValidationError(
  req: Request,
  res: Response,
  issues: z.ZodIssue[],
) {
  return sendApiError(req, res, 400, zodIssuesToErrorMessage(issues), {
    code: "VALIDATION_ERROR",
    details: zodIssuesToValidationIssues(issues),
  });
}

export function sendError(
  res: Response,
  status: number,
  message: string,
  req: Request,
  options: ApiErrorOptions = {}
) {
  // Helper function for consistent error responses with requestId
  return res.status(status).json(buildApiErrorResponse(req, status, message, options));
}

export function normalizeUnknownApiError(
  error: unknown,
  fallbackMessage: string,
): {
  statusCode: number;
  message: string;
  code?: string;
} {
  if (error && typeof error === "object") {
    const candidate = error as {
      message?: unknown;
      statusCode?: unknown;
      code?: unknown;
    };

    return {
      statusCode:
        typeof candidate.statusCode === "number" ? candidate.statusCode : 500,
      message:
        typeof candidate.message === "string" && candidate.message.trim().length > 0
          ? candidate.message
          : fallbackMessage,
      code: typeof candidate.code === "string" ? candidate.code : undefined,
    };
  }

  return {
    statusCode: 500,
    message: fallbackMessage,
  };
}
