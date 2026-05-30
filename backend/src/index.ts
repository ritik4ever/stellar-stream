import cors from "cors";
import { requestLogger } from "./middleware/requestLogger";
import "dotenv/config";
import express, { NextFunction, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import swaggerUi from "swagger-ui-express";
import { z } from "zod";
import {
  normalizeUnknownApiError,
  sendApiError,
  sendError,
  sendValidationError,
  adminAuth,
} from "./apiErrors";
import { swaggerDocument } from "./swagger";

import {
  countAllEvents,
  getAllEvents,
  getGlobalEvents,
  getStreamHistory,
  countStreamEvents,
  getStreamEventSummary,
} from "./services/eventHistory";
import { fetchOpenIssues } from "./services/openIssues";
import { initIndexer, startIndexer, getCircuitBreakerStatus } from "./services/indexer";
import { startReconciliationJob } from "./services/reconciliationJob";
import { startWebhookWorker } from "./services/webhookWorker";
import { getDeadLetters, countDeadLetters } from "./services/webhook";
import {
  archiveOldStreams,
  calculateProgress,
  cancelStream,
  createStream,
  getStream,
  initSoroban,
  listStreams,
  listStreamsByRecipient,
  listStreamsBySender,
  pauseStream,
  refreshStreamStatuses,
  resumeStream,
  StreamStatus,
  syncStreams,
  updateStreamStartAt,
  deleteStreamById,
} from "./services/streamStore";

import {
  authMiddleware,
  generateChallenge,
  refreshToken,
  verifyChallengeAndIssueToken,
} from "./services/auth";
import {
  createStreamPayloadWithAllowedAssetsSchema,
  listEventsQuerySchema,
  recipientAccountIdSchema,
  senderAccountIdSchema,
  streamIdSchema,
  updateStreamStartAtSchema,
  webhookRegistrationSchema,
} from "./validation/schemas";
import { validateEnv } from "./config/validateEnv";



const STREAM_STATUSES: StreamStatus[] = [
  "scheduled",
  "active",
  "completed",
  "canceled",
];
const PAGINATION_DEFAULT_PAGE = 1;
const PAGINATION_DEFAULT_LIMIT = 20;
const PAGINATION_MAX_LIMIT = 100;
const STREAM_HISTORY_DEFAULT_LIMIT = 50;
const STREAM_HISTORY_MAX_LIMIT = 200;

export const app = express();
const port = Number(process.env.PORT ?? 3001);
const ALLOWED_ASSETS = (process.env.ALLOWED_ASSETS || "USDC,XLM")
  .split(",")
  .map((asset) => asset.trim().toUpperCase());

const listStreamsQuerySchema = z.object({
  status: z
    .string()
    .optional()
    .refine(
      (value) => value === undefined || STREAM_STATUSES.includes(value as StreamStatus),
      {
        message: `status must be one of: ${STREAM_STATUSES.join(", ")}`,
      },
    ),
  recipient: z.string().trim().optional(),
  sender: z.string().trim().optional(),
  asset: z.string().trim().optional(),
  q: z.string().trim().optional(),
  include_archived: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
  page: z
    .coerce.number()
    .int("page must be an integer")
    .min(1, "page must be greater than or equal to 1")
    .optional(),
  limit: z
    .coerce.number()
    .int("limit must be an integer")
    .min(1, "limit must be greater than or equal to 1")
    .max(PAGINATION_MAX_LIMIT, `limit must be less than or equal to ${PAGINATION_MAX_LIMIT}`)
    .optional(),
});

app.use(cors());
app.use(requestLogger);
app.use(express.json());

// DELETE /api/streams/:id — Admin stream removal
app.delete(
  "/api/streams/:id",
  adminAuth,
  readLimiter,
  (req: Request, res: Response) => {
    const parsedId = streamIdSchema.safeParse({ id: req.params.id });
    if (!parsedId.success) {
      sendValidationError(req, res, parsedId.error.issues);
      return;
    }

    try {
      const deleted = deleteStreamById(parsedId.value);
      if (!deleted) {
        sendApiError(req, res, 404, "Stream not found.", { code: "NOT_FOUND" });
        return;
      }
      res.status(204).send();
    } catch (error: any) {
      console.error("Failed to delete stream:", error);
      const normalizedError = normalizeUnknownApiError(
        error,
        "Failed to delete stream.",
      );
      sendApiError(
        req,
        res,
        normalizedError.statusCode,
        normalizedError.message,
        {
          code: normalizedError.code ?? "INTERNAL_ERROR",
        },
      );
    }
  },
);
app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(swaggerDocument));

function parseStreamId(streamIdRaw: unknown):
  | { ok: true; value: string }
  | { ok: false; issues: z.ZodIssue[] } {
  if (typeof streamIdRaw !== "string") {
    return {
      ok: false,
      issues: [
        {
          code: "custom",
          message: "Stream ID must be a string.",
          path: ["id"],
        },
      ],
    };
  }

  const parsed = streamIdSchema.safeParse(streamIdRaw);
  if (!parsed.success) {
    return { ok: false, issues: parsed.error.issues };
  }
  return { ok: true, value: parsed.data };
}

app.get("/api/health", (_req: Request, res: Response) => {
  res.json({
    service: "stellar-stream-backend",
    status: "ok",
    timestamp: new Date().toISOString(),
  });
});

app.get("/api/metrics", (_req: Request, res: Response) => {
  res.json({
    indexer_circuit_breaker: getCircuitBreakerStatus(),
  });
});

app.get("/api/assets", (_req: Request, res: Response) => {
  res.json({
    data: ALLOWED_ASSETS,
  });
});

app.get("/api/streams", (req: Request, res: Response) => {
  const parsedQuery = listStreamsQuerySchema.safeParse(req.query);
  if (!parsedQuery.success) {
    sendValidationError(req, res, parsedQuery.error.issues);
    return;
  }

  const query = parsedQuery.data;
  const hasPage = req.query.page !== undefined;
  const hasLimit = req.query.limit !== undefined;

  let data = listStreams(query.include_archived).map((stream) => ({
    ...stream,
    progress: calculateProgress(stream),
  }));

  if (query.status) {
    data = data.filter((stream) => stream.progress.status === query.status);
  }
  if (query.recipient) {
    data = data.filter(
      (stream) =>
        stream.recipient.toLowerCase() === query.recipient!.toLowerCase(),
    );
  }
  if (query.sender) {
    data = data.filter(
      (stream) => stream.sender.toLowerCase() === query.sender!.toLowerCase(),
    );
  }
  if (query.asset) {
    data = data.filter(
      (stream) => stream.assetCode.toLowerCase() === query.asset!.toLowerCase(),
    );
  }
  if (query.q && query.q.length > 0) {
    const searchTerm = query.q.toLowerCase();
    data = data.filter((stream) => {
      return (
        stream.id.toLowerCase().includes(searchTerm) ||
        stream.sender.toLowerCase().includes(searchTerm) ||
        stream.recipient.toLowerCase().includes(searchTerm) ||
        stream.assetCode.toLowerCase().includes(searchTerm)
      );
    });
  }

  const total = data.length;
  const page = query.page ?? PAGINATION_DEFAULT_PAGE;
  const limit =
    !hasPage && !hasLimit
      ? total
      : (query.limit ?? PAGINATION_DEFAULT_LIMIT);

  const offset = (page - 1) * limit;
  const paginatedData = data.slice(offset, offset + limit);

  res.json({
    data: paginatedData,
    total,
    page,
    limit,
  });
});

app.get("/api/events", (req: Request, res: Response) => {
  const parsedQuery = listEventsQuerySchema.safeParse(req.query);
  if (!parsedQuery.success) {
    sendValidationError(req, res, parsedQuery.error.issues);
    return;
  }

  const query = parsedQuery.data;
  const hasPage = req.query.page !== undefined;
  const hasLimit = req.query.limit !== undefined;

  const eventType = query.eventType as Parameters<typeof getGlobalEvents>[2];
  const total = countAllEvents(eventType);

  const page = query.page ?? PAGINATION_DEFAULT_PAGE;
  const limit =
    !hasPage && !hasLimit ? total : (query.limit ?? PAGINATION_DEFAULT_LIMIT);

  const offset = (page - 1) * limit;
  const data = getGlobalEvents(limit === 0 ? 0 : limit, offset, eventType);

  res.json({ data, total, page, limit });
});


app.get("/api/streams/export.csv", (req: Request, res: Response) => {
  const parsedQuery = listStreamsQuerySchema.safeParse(req.query);
  if (!parsedQuery.success) {
    sendValidationError(req, res, parsedQuery.error.issues);
    return;
  }

  const query = parsedQuery.data;
  let data = listStreams(query.include_archived).map((stream) => ({
    ...stream,
    progress: calculateProgress(stream),
  }));

  if (query.status) {
    data = data.filter((stream) => stream.progress.status === query.status);
  }
  if (query.asset) {
    data = data.filter(
      (stream) => stream.assetCode.toLowerCase() === query.asset!.toLowerCase(),
    );
  }
  if (query.sender) {
    data = data.filter(
      (stream) => stream.sender.toLowerCase() === query.sender!.toLowerCase(),
    );
  }
  if (query.recipient) {
    data = data.filter(
      (stream) => stream.recipient.toLowerCase() === query.recipient!.toLowerCase(),
    );
  }

  const header = "id,sender,recipient,asset,total,status,startAt\n";
  const rows = data
    .map((stream) => {
      return `${stream.id},${stream.sender},${stream.recipient},${stream.assetCode},${stream.totalAmount},${stream.progress.status},${stream.startAt}`;
    })
    .join("\n");

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", 'attachment; filename="export.csv"');
  res.send(header + rows);
});

app.get("/api/streams/:id", (req: Request, res: Response) => {
  const parsedId = parseStreamId(req.params.id);
  if (!parsedId.ok) {
    sendValidationError(req, res, parsedId.issues);
    return;
  }

  const stream = getStream(parsedId.value);
  if (!stream) {
    sendApiError(req, res, 404, "Stream not found.", { code: "NOT_FOUND" });
    return;
  }

  res.json({
    data: {
      ...stream,
      progress: calculateProgress(stream)
    }
  });
});

app.get("/api/recipients/:accountId/streams", (req: Request, res: Response) => {
  const parsedParams = recipientAccountIdSchema.safeParse({
    accountId: req.params.accountId,
  });

  if (!parsedParams.success) {
    sendValidationError(req, res, parsedParams.error.issues);
    return;
  }

  const accountId = parsedParams.data.accountId;

  const parsedQuery = listStreamsQuerySchema.safeParse(req.query);
  if (!parsedQuery.success) {
    sendValidationError(req, res, parsedQuery.error.issues);
    return;
  }
  const query = parsedQuery.data;

  let data = listStreamsByRecipient(accountId)
    .map((stream) => ({
      ...stream,
      progress: calculateProgress(stream),
    }));

  // Apply filters
  if (query.status) {
    data = data.filter((stream) => stream.progress.status === query.status);
  }
  if (query.sender) {
    data = data.filter(
      (stream) => stream.sender.toLowerCase() === query.sender!.toLowerCase(),
    );
  }
  if (query.asset) {
    data = data.filter(
      (stream) => stream.assetCode.toLowerCase() === query.asset!.toLowerCase(),
    );
  }
  if (query.q && query.q.length > 0) {
    const searchTerm = query.q.toLowerCase();
    data = data.filter((stream) => {
      return (
        stream.id.toLowerCase().includes(searchTerm) ||
        stream.sender.toLowerCase().includes(searchTerm) ||
        stream.recipient.toLowerCase().includes(searchTerm) ||
        stream.assetCode.toLowerCase().includes(searchTerm)
      );
    });
  }

  // Apply pagination
  const hasPage = req.query.page !== undefined;
  const hasLimit = req.query.limit !== undefined;

  const total = data.length;
  const page = query.page ?? PAGINATION_DEFAULT_PAGE;
  const limit = !hasPage && !hasLimit ? total : (query.limit ?? PAGINATION_DEFAULT_LIMIT);

  const offset = (page - 1) * limit;
  const paginatedData = data.slice(offset, offset + limit);

  res.json({
    data: paginatedData,
    total,
    page,
    limit,
  });
});

app.get("/api/senders/:accountId/streams", (req: Request, res: Response) => {
  const parsedParams = senderAccountIdSchema.safeParse({
    accountId: req.params.accountId,
  });

  if (!parsedParams.success) {
    sendValidationError(req, res, parsedParams.error.issues);
    return;
  }

  const accountId = parsedParams.data.accountId;

  const parsedQuery = listStreamsQuerySchema.safeParse(req.query);
  if (!parsedQuery.success) {
    sendValidationError(req, res, parsedQuery.error.issues);
    return;
  }
  const query = parsedQuery.data;

  let data = listStreamsBySender(accountId)
    .map((stream) => ({
      ...stream,
      progress: calculateProgress(stream),
    }));

  if (query.status) {
    data = data.filter((stream) => stream.progress.status === query.status);
  }
  if (query.recipient) {
    data = data.filter(
      (stream) => stream.recipient.toLowerCase() === query.recipient!.toLowerCase(),
    );
  }
  if (query.asset) {
    data = data.filter(
      (stream) => stream.assetCode.toLowerCase() === query.asset!.toLowerCase(),
    );
  }
  if (query.q && query.q.length > 0) {
    const searchTerm = query.q.toLowerCase();
    data = data.filter((stream) => {
      return (
        stream.id.toLowerCase().includes(searchTerm) ||
        stream.sender.toLowerCase().includes(searchTerm) ||
        stream.recipient.toLowerCase().includes(searchTerm) ||
        stream.assetCode.toLowerCase().includes(searchTerm)
      );
    });
  }

  const hasPage = req.query.page !== undefined;
  const hasLimit = req.query.limit !== undefined;

  const total = data.length;
  const page = query.page ?? PAGINATION_DEFAULT_PAGE;
  const limit = !hasPage && !hasLimit ? total : (query.limit ?? PAGINATION_DEFAULT_LIMIT);

  const offset = (page - 1) * limit;
  const paginatedData = data.slice(offset, offset + limit);

  res.json({
    data: paginatedData,
    total,
    page,
    limit,
  });
});

app.get("/api/auth/challenge", (req: Request, res: Response) => {
  const accountId = req.query.accountId;
  if (typeof accountId !== "string" || !accountId.trim()) {
    sendApiError(req, res, 400, "accountId query parameter is required.", {
      code: "VALIDATION_ERROR",
    });
    return;
  }

  try {
    const challengeTransaction = generateChallenge(accountId.trim());
    res.json({ transaction: challengeTransaction });
  } catch (error: any) {
    console.error("Failed to generate challenge:", error);
    const normalizedError = normalizeUnknownApiError(error, "Failed to generate challenge.");
    sendApiError(req, res, normalizedError.statusCode, normalizedError.message, {
      code: normalizedError.code ?? "INTERNAL_ERROR",
    });
  }
});

app.post("/api/auth/token", (req: Request, res: Response) => {
  const transaction = req.body?.transaction;
  if (typeof transaction !== "string" || !transaction.trim()) {
    sendApiError(req, res, 400, "transaction in body is required.", {
      code: "VALIDATION_ERROR",
    });
    return;
  }

  try {
    const token = verifyChallengeAndIssueToken(transaction);
    res.json({ token });
  } catch (error: any) {
    console.error("Failed to verify challenge:", error);
    const normalizedError = normalizeUnknownApiError(error, "Failed to verify challenge.");
    sendApiError(req, res, normalizedError.statusCode, normalizedError.message, {
      code: normalizedError.code ?? "INTERNAL_ERROR",
    });
  }
});

// POST /api/auth/refresh — accepts a valid Bearer JWT, returns a new one with fresh 24h expiry
app.post("/api/auth/refresh", refreshToken);

app.post("/api/streams", authMiddleware, async (req: Request, res: Response) => {
  const parsedBody = createStreamPayloadWithAllowedAssetsSchema(ALLOWED_ASSETS).safeParse(
    req.body,
  );
  if (!parsedBody.success) {
    sendValidationError(req, res, parsedBody.error.issues);
    return;
  }



  try {
    const stream = await createStream(parsedBody.data);
    res.status(201).json({
      data: {
        ...stream,
        progress: calculateProgress(stream),
      },
    });
  } catch (error: any) {
    console.error("Failed to create stream:", error);
    const normalizedError = normalizeUnknownApiError(error, "Failed to create stream.");
    sendApiError(req, res, normalizedError.statusCode, normalizedError.message, {
      code: normalizedError.code ?? "INTERNAL_ERROR",
    });
  }
});

app.post(
  "/api/streams/:id/cancel",
  authMiddleware,
  async (req: Request, res: Response) => {
    const parsedId = parseStreamId(req.params.id);
    if (!parsedId.ok) {
      sendValidationError(req, res, parsedId.issues);
      return;
    }

    const stream = getStream(parsedId.value);
    if (!stream) {
      sendApiError(req, res, 404, "Stream not found.", { code: "NOT_FOUND" });
      return;
    }

    const user = (req as any).user;
    if (stream.sender !== user.accountId) {
      sendApiError(req, res, 403, "Only the sender can cancel this stream.", {
        code: "FORBIDDEN",
      });
      return;
    }

    try {
      const canceledStream = await cancelStream(parsedId.value);
      res.json({ data: { ...canceledStream, progress: calculateProgress(canceledStream) } });
    } catch (error: any) {
      console.error("Failed to cancel stream:", error);
      const normalizedError = normalizeUnknownApiError(error, "Failed to cancel stream.");
      sendApiError(req, res, normalizedError.statusCode, normalizedError.message, {
        code: normalizedError.code ?? "INTERNAL_ERROR",
      });
    }
  },
);

// POST /api/streams/:id/claim — recipient claims vested tokens
app.post(
  "/api/streams/:id/claim",
  authMiddleware,
  async (req: Request, res: Response) => {
    const parsedId = parseStreamId(req.params.id);
    if (!parsedId.ok) {
      sendValidationError(req, res, parsedId.issues);
      return;
    }

    const stream = getStream(parsedId.value);
    if (!stream) {
      sendApiError(req, res, 404, "Stream not found.", { code: "NOT_FOUND" });
      return;
    }

    const user = (req as any).user;
    if (stream.recipient !== user.accountId) {
      sendApiError(req, res, 403, "Only the recipient can claim this stream.", {
        code: "FORBIDDEN",
      });
      return;
    }

    const progress = calculateProgress(stream);
    if (progress.vestedAmount <= 0) {
      sendApiError(req, res, 400, "No claimable amount available.", {
        code: "NO_CLAIMABLE_AMOUNT",
      });
      return;
    }

    try {
      // Record the claim event in the local DB.
      // In a full on-chain implementation this would submit a `claim` Soroban tx.
      const db = (await import("./services/db")).getDb();
      const { recordEventWithDb } = await import("./services/eventHistory");
      const now = Math.floor(Date.now() / 1000);
      db.transaction(() => {
        recordEventWithDb(
          db,
          stream.id,
          "claimed",
          now,
          stream.recipient,
          progress.vestedAmount,
          { assetCode: stream.assetCode },
        );
      })();

      const history = await import("./services/eventHistory").then((m) =>
        m.getStreamHistory(stream.id),
      );

      res.json({
        result: {
          claimedAmount: progress.vestedAmount,
          assetCode: stream.assetCode,
          txHash: `local-${stream.id}-${now}`,
        },
        history,
      });
    } catch (error: any) {
      console.error("Failed to record claim:", error);
      const normalizedError = normalizeUnknownApiError(error, "Failed to process claim.");
      sendApiError(req, res, normalizedError.statusCode, normalizedError.message, {
        code: normalizedError.code ?? "INTERNAL_ERROR",
      });
    }
  },
);

app.patch(
  "/api/streams/:id/start-time",
  authMiddleware,
  (req: Request, res: Response) => {
    const parsedId = parseStreamId(req.params.id);
    if (!parsedId.ok) {
      sendValidationError(req, res, parsedId.issues);
      return;
    }

    const existingStream = getStream(parsedId.value);
    if (!existingStream) {
      sendApiError(req, res, 404, "Stream not found.", { code: "NOT_FOUND" });
      return;
    }

    const user = (req as any).user;
    if (user && existingStream.sender !== user.accountId) {
      sendApiError(req, res, 403, "Only stream sender can update the start time.", {
        code: "FORBIDDEN",
      });
      return;
    }

    const parsedBody = updateStreamStartAtSchema.safeParse(req.body);
    if (!parsedBody.success) {
      sendValidationError(req, res, parsedBody.error.issues);
      return;
    }

    try {
      const updatedStream = updateStreamStartAt(parsedId.value, parsedBody.data.startAt);
      res.json({ data: { ...updatedStream, progress: calculateProgress(updatedStream) } });
    } catch (error: any) {
      const normalizedError = normalizeUnknownApiError(
        error,
        "Failed to update stream start time.",
      );
      sendApiError(req, res, normalizedError.statusCode, normalizedError.message, {
        code: normalizedError.code ?? "INTERNAL_ERROR",
      });
    }
  },
);

app.patch(
  "/api/streams/:id/pause",
  authMiddleware,
  async (req: Request, res: Response) => {
    const parsedId = parseStreamId(req.params.id);
    if (!parsedId.ok) {
      sendValidationError(req, res, parsedId.issues);
      return;
    }

    const stream = getStream(parsedId.value);
    if (!stream) {
      sendApiError(req, res, 404, "Stream not found.", { code: "NOT_FOUND" });
      return;
    }

    const user = (req as any).user;
    if (stream.sender !== user.accountId) {
      sendApiError(req, res, 403, "Only the sender can pause this stream.", {
        code: "FORBIDDEN",
      });
      return;
    }

    try {
      const pausedStream = await pauseStream(parsedId.value);
      res.json({ data: { ...pausedStream, progress: calculateProgress(pausedStream!) } });
    } catch (error: any) {
      console.error("Failed to pause stream:", error);
      const normalizedError = normalizeUnknownApiError(error, "Failed to pause stream.");
      sendApiError(req, res, normalizedError.statusCode, normalizedError.message, {
        code: normalizedError.code ?? "INTERNAL_ERROR",
      });
    }
  },
);

app.patch(
  "/api/streams/:id/resume",
  authMiddleware,
  async (req: Request, res: Response) => {
    const parsedId = parseStreamId(req.params.id);
    if (!parsedId.ok) {
      sendValidationError(req, res, parsedId.issues);
      return;
    }

    const stream = getStream(parsedId.value);
    if (!stream) {
      sendApiError(req, res, 404, "Stream not found.", { code: "NOT_FOUND" });
      return;
    }

    const user = (req as any).user;
    if (stream.sender !== user.accountId) {
      sendApiError(req, res, 403, "Only the sender can resume this stream.", {
        code: "FORBIDDEN",
      });
      return;
    }

    try {
      const resumedStream = await resumeStream(parsedId.value);
      res.json({ data: { ...resumedStream, progress: calculateProgress(resumedStream!) } });
    } catch (error: any) {
      console.error("Failed to resume stream:", error);
      const normalizedError = normalizeUnknownApiError(error, "Failed to resume stream.");
      sendApiError(req, res, normalizedError.statusCode, normalizedError.message, {
        code: normalizedError.code ?? "INTERNAL_ERROR",
      });
    }
  },
);

app.get("/api/streams/:id/history", (req: Request, res: Response) => {
  const parsedId = parseStreamId(req.params.id);
  if (!parsedId.ok) {
    sendValidationError(req, res, parsedId.issues);
    return;
  }

  const stream = getStream(parsedId.value);
  if (!stream) {
    sendApiError(req, res, 404, "Stream not found.", { code: "NOT_FOUND" });
    return;
  }

  // Parse and validate query parameters
  const limit = Math.min(
    Math.max(1, parseInt(req.query.limit as string) || STREAM_HISTORY_DEFAULT_LIMIT),
    STREAM_HISTORY_MAX_LIMIT
  );
  const offset = Math.max(0, parseInt(req.query.offset as string) || 0);

  const total = countStreamEvents(parsedId.value);
  const data = getStreamHistory(parsedId.value, limit, offset);

  res.json({ data, total, limit, offset });
});

app.get("/api/streams/:id/history/summary", (req: Request, res: Response) => {
  const parsedId = parseStreamId(req.params.id);
  if (!parsedId.ok) {
    sendValidationError(req, res, parsedId.issues);
    return;
  }

  const stream = getStream(parsedId.value);
  if (!stream) {
    sendApiError(req, res, 404, "Stream not found.", { code: "NOT_FOUND" });
    return;
  }

  res.json({ data: getStreamEventSummary(parsedId.value) });
});

app.get("/api/streams/:id/snapshot", (req: Request, res: Response) => {
  const parsedId = parseStreamId(req.params.id);
  if (!parsedId.ok) {
    sendValidationError(req, res, parsedId.issues);
    return;
  }

  const stream = getStream(parsedId.value);
  if (!stream) {
    sendApiError(req, res, 404, "Stream not found.", { code: "NOT_FOUND" });
    return;
  }

  const progress = calculateProgress(stream);
  const history = getStreamHistory(parsedId.value);

  res.json({
    data: {
      stream: {
        ...stream,
        progress,
      },
      history,
    },
  });
});

app.get("/api/open-issues", async (req: Request, res: Response) => {
  try {
    const data = await fetchOpenIssues();
    res.json({ data });
  } catch (error: any) {
    console.error("Failed to fetch open issues from proxy:", error);
    const normalizedError = normalizeUnknownApiError(error, "Failed to fetch open issues.");
    sendApiError(req, res, normalizedError.statusCode, normalizedError.message, {
      code: normalizedError.code ?? "INTERNAL_ERROR",
    });
  }
});

app.get("/api/webhooks/dead-letters", authMiddleware, (req: Request, res: Response) => {
  const page = req.query.page ? parseInt(req.query.page as string, 10) : PAGINATION_DEFAULT_PAGE;
  const limit = req.query.limit ? parseInt(req.query.limit as string, 10) : PAGINATION_DEFAULT_LIMIT;

  if (isNaN(page) || page < 1) {
    sendApiError(req, res, 400, "page must be a positive integer", { code: "VALIDATION_ERROR" });
    return;
  }

  if (isNaN(limit) || limit < 1 || limit > PAGINATION_MAX_LIMIT) {
    sendApiError(req, res, 400, `limit must be between 1 and ${PAGINATION_MAX_LIMIT}`, { code: "VALIDATION_ERROR" });
    return;
  }

  try {
    const total = countDeadLetters();
    const offset = (page - 1) * limit;
    const data = getDeadLetters(limit, offset);

    res.json({
      data,
      total,
      page,
      limit,
    });
  } catch (error: any) {
    console.error("Failed to fetch dead-letter webhooks:", error);
    const normalizedError = normalizeUnknownApiError(error, "Failed to fetch dead-letter webhooks.");
    sendApiError(req, res, normalizedError.statusCode, normalizedError.message, {
      code: normalizedError.code ?? "INTERNAL_ERROR",
    });
  }
});




async function startServer() {
  // ── Validate environment first — exits with code 1 on bad config ──────
  const config = validateEnv();

  await initSoroban();
  await syncStreams();

  // Run refreshStreamStatuses on startup and then on a configurable interval.
  // STATUS_REFRESH_INTERVAL_MS=0 disables automatic refresh.
  const statusRefreshInterval = Number(
    process.env.STATUS_REFRESH_INTERVAL_MS ?? 60_000,
  );
  const runRefresh = () => {
    try {
      const transitioned = refreshStreamStatuses();
      if (transitioned > 0) {
        console.log(
          `[status-refresh] ${transitioned} stream(s) transitioned to completed`,
        );
      }
    } catch (err) {
      console.error("[status-refresh] failed:", err);
    }
  };
  runRefresh(); // run once on startup
  if (statusRefreshInterval > 0) {
    setInterval(runRefresh, statusRefreshInterval);
    console.log(
      `[status-refresh] scheduled every ${statusRefreshInterval}ms`,
    );
  } else {
    console.log("[status-refresh] automatic refresh disabled (interval=0)");
  }

  // Archive old streams on startup
  await archiveOldStreams();

  // Schedule archive job to run every 24 hours
  setInterval(async () => {
    try {
      const archived = await archiveOldStreams();
      if (archived > 0) {
        console.log(`[scheduler] archived ${archived} stream(s)`);
      }
    } catch (err) {
      console.error("[scheduler] archive job failed:", err);
    }
  }, 24 * 60 * 60 * 1000);

  // Initialize and start event indexer
  if (config.sorobanEnabled && config.contractId) {
    initIndexer(config.rpcUrl, config.contractId, config.networkPassphrase);
    startIndexer(10000); // Poll every 10 seconds
    startReconciliationJob(
      Number(process.env.RECONCILIATION_INTERVAL_MS ?? 60000),
    );
  } else {
    console.warn("CONTRACT_ID not set, event indexer will not start");
  }

  app.listen(config.port, () => {
    console.log(`StellarStream API listening on http://localhost:${config.port}`);
  });
}

if (require.main === module) {
  startServer().catch(console.error);
}
