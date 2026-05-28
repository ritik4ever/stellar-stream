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
import {
  initIndexer,
  startIndexer,
  getCircuitBreakerStatus,
} from "./services/indexer";
import { adminAuth } from "./middleware/adminAuth";
import { deleteStreamById } from "./services/streamStore";

import { startReconciliationJob } from "./services/reconciliationJob";
import { startWebhookWorker } from "./services/webhookWorker";
import {
  getDeadLetters,
  countDeadLetters,
  requeueDeadLetter,
} from "./services/webhook";
import {
  archiveOldStreams,
  calculateProgress,
  cancelStream,
  createStream,
  getStream,
  getOnChainClaimableAmount,
  getLatestLedgerTime,
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
} from "./validation/schemas";
import { validateEnv } from "./config/validateEnv";
import { getMetricsHistory } from "./services/metricsHistory";
import { initCache } from "./services/cache";

const STREAM_STATUSES: StreamStatus[] = [
  "scheduled",
  "active",
  "paused",
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
      (value) =>
        value === undefined || STREAM_STATUSES.includes(value as StreamStatus),
      {
        message: `status must be one of: ${STREAM_STATUSES.join(", ")}`,
      },
    ),
  recipient: z.string().trim().optional(),
  sender: z.string().trim().optional(),
  asset: z.string().trim().optional(),
  assetCode: z
    .string()
    .trim()
    .optional()
    .transform((value) => {
      if (!value) return undefined;
      return value.split(",").map((code) => code.trim().toUpperCase());
    }),
  q: z.string().trim().optional(),
  minAmount: z.coerce
    .number()
    .nonnegative("minAmount must be a non-negative number")
    .optional(),
  maxAmount: z.coerce
    .number()
    .nonnegative("maxAmount must be a non-negative number")
    .optional(),
  include_archived: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => v === "true"),
  page: z.coerce
    .number()
    .int("page must be an integer")
    .min(1, "page must be greater than or equal to 1")
    .optional(),
  limit: z.coerce
    .number()
    .int("limit must be an integer")
    .min(1, "limit must be an integer")
    .max(
      PAGINATION_MAX_LIMIT,
      `limit must be less than or equal to ${PAGINATION_MAX_LIMIT}`,
    )
    .optional(),
});

const AUTH_CHALLENGE_RATE_LIMIT = Number(
  process.env.AUTH_CHALLENGE_RATE_LIMIT ?? 10,
);

const authChallengeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: AUTH_CHALLENGE_RATE_LIMIT,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req: Request, res: Response) => {
    const resetTime = (req as any).rateLimit?.resetTime;
    const retryAfter = resetTime
      ? Math.ceil((resetTime.getTime() - Date.now()) / 1000)
      : 60;
    res.set("Retry-After", String(Math.max(1, retryAfter)));
    sendApiError(req, res, 429, "Too many requests. Please try again later.", {
      code: "RATE_LIMIT_EXCEEDED",
    });
  },
});

// Rate limiters for read and mutation endpoints
const READ_RATE_LIMIT = Number(process.env.READ_RATE_LIMIT ?? 120);
const MUTATION_RATE_LIMIT = Number(process.env.MUTATION_RATE_LIMIT ?? 10);

const readLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: READ_RATE_LIMIT,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req: Request, res: Response) => {
    const resetTime = (req as any).rateLimit?.resetTime;
    const retryAfter = resetTime
      ? Math.ceil((resetTime.getTime() - Date.now()) / 1000)
      : 60;
    res.set("Retry-After", String(Math.max(1, retryAfter)));
    sendApiError(req, res, 429, "Too many requests. Please try again later.", {
      code: "RATE_LIMIT_EXCEEDED",
    });
  },
});

const mutationLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: MUTATION_RATE_LIMIT,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req: Request, res: Response) => {
    const resetTime = (req as any).rateLimit?.resetTime;
    const retryAfter = resetTime
      ? Math.ceil((resetTime.getTime() - Date.now()) / 1000)
      : 60;
    res.set("Retry-After", String(Math.max(1, retryAfter)));
    sendApiError(req, res, 429, "Too many requests. Please try again later.", {
      code: "RATE_LIMIT_EXCEEDED",
    });
  },
});

const CLAIMABLE_RATE_LIMIT = Number(process.env.CLAIMABLE_RATE_LIMIT ?? 30);

const claimableLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: CLAIMABLE_RATE_LIMIT,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req: Request, res: Response) => {
    const resetTime = (req as any).rateLimit?.resetTime;
    const retryAfter = resetTime
      ? Math.ceil((resetTime.getTime() - Date.now()) / 1000)
      : 60;
    res.set("Retry-After", String(Math.max(1, retryAfter)));
    sendApiError(req, res, 429, "Too many requests. Please try again later.", {
      code: "RATE_LIMIT_EXCEEDED",
    });
  },
});

app.use(cors());
app.use(requestLogger);
app.use(
  express.json({
    limit: "32kb",
    strict: true,
  }),
);

// Handle oversized payloads (413) and malformed JSON (400) from the body parser
app.use((err: any, req: Request, res: Response, next: NextFunction) => {
  if (err.type === "entity.too.large") {
    res.status(413).json({ error: "Payload too large" });
    return;
  }
  if (
    err.type === "entity.parse.failed" ||
    err.status === 400 ||
    err instanceof SyntaxError
  ) {
    res.status(400).json({ error: "Invalid JSON" });
    return;
  }
  next(err);
});

app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(swaggerDocument));

function parseStreamId(
  streamIdRaw: unknown,
): { ok: true; value: string } | { ok: false; issues: z.ZodIssue[] } {
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

const METRICS_AUTH = process.env.METRICS_AUTH?.trim() || null; // format: "user:password"

app.get("/api/metrics", async (_req: Request, res: Response) => {
  // Optional basic auth check
  if (METRICS_AUTH) {
    const authHeader = _req.headers.authorization;
    const expected = "Basic " + Buffer.from(METRICS_AUTH).toString("base64");
    if (!authHeader || authHeader !== expected) {
      res.setHeader("WWW-Authenticate", 'Basic realm="metrics"');
      res.status(401).send("Unauthorized");
      return;
    }
  }

  const output = await metricsRegistry.metrics();
  res.setHeader("Content-Type", "text/plain; version=0.0.4");
  res.send(output);
});

// GET /api/metrics/history?days=7 — daily aggregate metrics for the past N days (max 90)
app.get(
  "/api/metrics/history",
  readLimiter,
  async (req: Request, res: Response) => {
    const rawDays = req.query.days;
    const days = rawDays !== undefined ? parseInt(rawDays as string, 10) : 7;

    if (isNaN(days) || days < 1 || days > 90) {
      sendApiError(req, res, 400, "days must be an integer between 1 and 90.", {
        code: "VALIDATION_ERROR",
      });
      return;
    }

    try {
      const data = await getMetricsHistory(days);
      res.json({ data });
    } catch (error: any) {
      console.error("Failed to fetch metrics history:", error);
      const normalizedError = normalizeUnknownApiError(
        error,
        "Failed to fetch metrics history.",
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

app.get("/api/assets", (_req: Request, res: Response) => {
  res.json({
    data: ALLOWED_ASSETS,
  });
});


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
  if (query.assetCode && query.assetCode.length > 0) {
    data = data.filter((stream) =>
      query.assetCode!.includes(stream.assetCode.toUpperCase()),
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
  if (query.minAmount !== undefined) {
    data = data.filter((stream) => stream.totalAmount >= query.minAmount!);
  }
  if (query.maxAmount !== undefined) {
    data = data.filter((stream) => stream.totalAmount <= query.maxAmount!);
  }

  const total = data.length;
  const page = query.page ?? PAGINATION_DEFAULT_PAGE;
  const limit =
    !hasPage && !hasLimit ? total : (query.limit ?? PAGINATION_DEFAULT_LIMIT);

  const offset = (page - 1) * limit;
  const paginatedData = data.slice(offset, offset + limit);

  res.json({
    data: paginatedData,
    total,
    page,
    limit,
  });
});

app.get("/api/events", readLimiter, (req: Request, res: Response) => {
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
  const data = getGlobalEvents(
    limit === 0 ? 0 : limit,
    offset,
    eventType,
    query.cursor,
  );

  res.json({ data, total, page, limit });
});

app.get(
  "/api/streams/export.csv",
  readLimiter,
  (req: Request, res: Response) => {
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
        (stream) =>
          stream.assetCode.toLowerCase() === query.asset!.toLowerCase(),
      );
    }
    if (query.assetCode && query.assetCode.length > 0) {
      data = data.filter((stream) =>
        query.assetCode!.includes(stream.assetCode.toUpperCase()),
      );
    }
    if (query.sender) {
      data = data.filter(
        (stream) => stream.sender.toLowerCase() === query.sender!.toLowerCase(),
      );
    }
    if (query.recipient) {
      data = data.filter(
        (stream) =>
          stream.recipient.toLowerCase() === query.recipient!.toLowerCase(),
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
  },
);

app.get("/api/streams/:id", readLimiter, (req: Request, res: Response) => {
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
      progress: calculateProgress(stream),
    },
  });
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

    let data = listStreamsByRecipient(accountId).map((stream) => ({
      ...stream,
      progress: calculateProgress(stream),
    }));

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
        (stream) =>
          stream.assetCode.toLowerCase() === query.asset!.toLowerCase(),
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
    const limit =
      !hasPage && !hasLimit ? total : (query.limit ?? PAGINATION_DEFAULT_LIMIT);

    const offset = (page - 1) * limit;
    const paginatedData = data.slice(offset, offset + limit);

    res.json({
      data: paginatedData,
      total,
      page,
      limit,
    });
  },
);

app.get(
  "/api/senders/:accountId/streams",
  readLimiter,
  (req: Request, res: Response) => {
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

    let data = listStreamsBySender(accountId).map((stream) => ({
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
    if (query.asset) {
      data = data.filter(
        (stream) =>
          stream.assetCode.toLowerCase() === query.asset!.toLowerCase(),
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
    const limit =
      !hasPage && !hasLimit ? total : (query.limit ?? PAGINATION_DEFAULT_LIMIT);

    const offset = (page - 1) * limit;
    const paginatedData = data.slice(offset, offset + limit);

    res.json({
      data: paginatedData,
      total,
      page,
      limit,
    });

app.post("/api/auth/token", async (req: Request, res: Response) => {
  const transaction = req.body?.transaction;
  if (typeof transaction !== "string" || !transaction.trim()) {
    sendApiError(req, res, 400, "transaction in body is required.", {
      code: "VALIDATION_ERROR",
    });
    return;
  }

  try {
    const token = await verifyChallengeAndIssueToken(transaction);
    res.json({ token });
  } catch (error: any) {

  }
});

// POST /api/auth/refresh — accepts a valid Bearer JWT, returns a new one with fresh 24h expiry
app.post("/api/auth/refresh", refreshToken);

app.post(
  "/api/streams",
  mutationLimiter,
  authMiddleware,
  async (req: Request, res: Response) => {
    const parsedBody = createStreamPayloadWithAllowedAssetsSchema(
      ALLOWED_ASSETS,
    ).safeParse(req.body);
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
      const normalizedError = normalizeUnknownApiError(
        error,
        "Failed to create stream.",
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

app.post(
  "/api/streams/:id/cancel",
  mutationLimiter,
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
      const updated = await cancelStream(parsedId.value);
      res.json({
        data: {
          ...updated,
          progress: calculateProgress(updated),
        },
      });
    } catch (error: any) {
      console.error("Failed to cancel stream:", error);
      const normalizedError = normalizeUnknownApiError(
        error,
        "Failed to cancel stream.",
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

// POST /api/streams/:id/pause — sender pauses an active stream
app.post(
  "/api/streams/:id/pause",
  mutationLimiter,
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
      const updated = await pauseStream(parsedId.value);
      res.json({ data: { ...updated, progress: calculateProgress(updated) } });
    } catch (error: any) {
      const normalizedError = normalizeUnknownApiError(
        error,
        "Failed to pause stream.",
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

// POST /api/streams/:id/resume — sender resumes a paused stream
app.post(
  "/api/streams/:id/resume",
  mutationLimiter,
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
      const updated = await resumeStream(parsedId.value);
      res.json({ data: { ...updated, progress: calculateProgress(updated) } });
    } catch (error: any) {
      const normalizedError = normalizeUnknownApiError(
        error,
        "Failed to resume stream.",
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

// POST /api/streams/:id/claim — recipient claims vested tokens
app.post(
  "/api/streams/:id/claim",
  mutationLimiter,
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
      const normalizedError = normalizeUnknownApiError(
        error,
        "Failed to process claim.",
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

      return;
    }

    const parsedBody = updateStreamStartAtSchema.safeParse(req.body);
    if (!parsedBody.success) {
      sendValidationError(req, res, parsedBody.error.issues);
      return;
    }

    try {

    }
  },
);

app.get(
  "/api/streams/:id/history",
  readLimiter,
  (req: Request, res: Response) => {
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
      Math.max(
        1,
        parseInt(req.query.limit as string) || STREAM_HISTORY_DEFAULT_LIMIT,
      ),
      STREAM_HISTORY_MAX_LIMIT,
    );
    const offset = Math.max(0, parseInt(req.query.offset as string) || 0);

    const total = countStreamEvents(parsedId.value);
    const data = getStreamHistory(parsedId.value, limit, offset);

    res.json({ data, total, limit, offset });
  },
);

app.get(
  "/api/streams/:id/history/summary",
  readLimiter,
  (req: Request, res: Response) => {
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
  },
);

app.get(
  "/api/streams/:id/snapshot",
  readLimiter,
  (req: Request, res: Response) => {
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
  },
);

app.get("/api/open-issues", async (req: Request, res: Response) => {
  try {
    const data = await fetchOpenIssues();
    res.json({ data });
  } catch (error: any) {
    console.error("Failed to fetch open issues from proxy:", error);
    const normalizedError = normalizeUnknownApiError(
      error,
      "Failed to fetch open issues.",
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
});

app.get(
  "/api/webhooks/dead-letters",
  authMiddleware,
  (req: Request, res: Response) => {
    const page = req.query.page
      ? parseInt(req.query.page as string, 10)
      : PAGINATION_DEFAULT_PAGE;
    const limit = req.query.limit
      ? parseInt(req.query.limit as string, 10)
      : PAGINATION_DEFAULT_LIMIT;

    if (isNaN(page) || page < 1) {
      sendApiError(req, res, 400, "page must be a positive integer", {
        code: "VALIDATION_ERROR",
      });
      return;
    }

    if (isNaN(limit) || limit < 1 || limit > PAGINATION_MAX_LIMIT) {
      sendApiError(
        req,
        res,
        400,
        `limit must be between 1 and ${PAGINATION_MAX_LIMIT}`,
        { code: "VALIDATION_ERROR" },
      );
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
      const normalizedError = normalizeUnknownApiError(
        error,
        "Failed to fetch dead-letter webhooks.",
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

app.get(
  "/api/webhooks/dead-letters/count",
  authMiddleware,
  (req: Request, res: Response) => {
    try {
      const total = countDeadLetters();
      res.json({ total });
    } catch (error: any) {
      console.error("Failed to count dead-letter webhooks:", error);
      const normalizedError = normalizeUnknownApiError(
        error,
        "Failed to count dead-letter webhooks.",
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

app.post(
  "/api/webhooks/dead-letters/:id/requeue",
  authMiddleware,
  (req: Request, res: Response) => {
    const id = parseInt(req.params.id, 10);
    if (isNaN(id)) {
      sendApiError(req, res, 400, "Invalid ID format", {
        code: "VALIDATION_ERROR",
      });
      return;
    }

    try {
      const success = requeueDeadLetter(id);
      if (!success) {
        sendApiError(req, res, 404, "Dead letter not found", {
          code: "NOT_FOUND",
        });
        return;
      }
      res.json({ success: true, message: "Webhook re-queued successfully" });
    } catch (error: any) {
      console.error("Failed to re-queue dead-letter webhook:", error);
      const normalizedError = normalizeUnknownApiError(
        error,
        "Failed to re-queue dead-letter webhook.",
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

async function startServer() {
  const config = validateEnv();

  initCache();

  await initSoroban();
  await syncStreams();

  if (config.sorobanEnabled && config.contractId) {
    initIndexer(config.rpcUrl, config.contractId, config.networkPassphrase);
    startIndexer(config.indexerPollIntervalMs);
    startReconciliationJob(
      config.reconciliationIntervalMs,
    );
  } else {
    console.warn("CONTRACT_ID not set, event indexer will not start");
  }

  app.listen(config.port, () => {
    console.log(
      `StellarStream API listening on http://localhost:${config.port}`,
    );
  });
}

if (require.main === module) {
  startServer().catch(console.error);
}

app.delete("/api/streams/:id", adminAuth, (req: Request, res: Response) => {
  const parsedId = parseStreamId(req.params.id);
  if (!parsedId.ok) {
    sendValidationError(req, res, parsedId.issues);
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
});
