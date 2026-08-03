import cors from "cors";
import helmet from "helmet";
import { requestLogger } from "./middleware/requestLogger";
import { requireJsonContentType } from "./middleware/contentType";
import "dotenv/config";
import express, { NextFunction, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import swaggerUi from "swagger-ui-express";
import { z } from "zod";
import { createServer } from "http";
import { searchStreamsFts, getAllowedAssets, addAllowedAsset, removeAllowedAsset } from "./services/db";
import { initWebSocket } from "./services/websocket";
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
  StreamEventType,
} from "./services/eventHistory";
import { fetchOpenIssues } from "./services/openIssues";
import {
  initIndexer,
  startIndexer,
  getCircuitBreakerStatus,
} from "./services/indexer";
import { adminAuth } from "./middleware/adminAuth";
import { deleteStreamById, reconcileStream } from "./services/streamStore";
import { getCache } from "./services/cache";
import { getStreamStats } from "./services/stats";
import { getStreamMetrics } from "./services/streamMetrics";

import { startReconciliationJob } from "./services/reconciliationJob";
import { startArchiveJob } from "./services/archiveJob";
import { startStreamProgressBroadcaster } from "./services/streamProgressBroadcaster";
import { startWebhookWorker } from "./services/webhookWorker";
import { startDeadLetterPruningJob } from "./services/webhookDeadLetterPruningJob";
import {
  clearDeadLetters,
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
  getOnChainClaimableBatch,
  getLatestLedgerTime,
  initSoroban,
  listStreams,
  listStreamsByRecipient,
  listStreamsBySender,
  markStreamComplete,
  nowInSeconds,
  pauseStream,
  estimateCreateStreamFee,
  refreshStreamStatuses,
  resumeStream,
  StreamRecord,
  StreamStatus,
  syncStreams,
  updateStreamStartAt,
  getOnChainStreamCount,
} from "./services/streamStore";

import {
  authMiddleware,
  adminJwtAuth,
  generateChallenge,
  refreshToken,
  verifyChallengeAndIssueToken,
  getJwtSecret,
} from "./services/auth";
import jwt from "jsonwebtoken";
import {
  bulkCancelStreamsSchema,
  createStreamPayloadWithAllowedAssetsSchema,
  listEventsQuerySchema,
  recipientAccountIdSchema,
  senderAccountIdSchema,
  streamIdSchema,
  updateStreamStartAtSchema,
} from "./validation/schemas";
import { validateEnv } from "./config/validateEnv";
import { getMetricsHistory } from "./services/metricsHistory";
import { register } from "./services/metrics";
import { initCache } from "./services/cache";
import { getGlobalStats } from "./services/stats";
import { logger } from "./logger";

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

const SORT_FIELDS = ["totalAmount", "startAt", "createdAt", "durationSeconds"] as const;
const SORT_ORDERS = ["asc", "desc"] as const;

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
  sort: z
    .enum(SORT_FIELDS)
    .optional(),
  order: z
    .enum(SORT_ORDERS)
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
  handler: (req: Request, res: Response, next: any) => {
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
const READ_RATE_LIMIT = Number(process.env.READ_RATE_LIMIT ?? 5000);
const MUTATION_RATE_LIMIT = Number(process.env.MUTATION_RATE_LIMIT ?? 10);

const readLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: READ_RATE_LIMIT,
  standardHeaders: true,
  legacyHeaders: false,
  handler: (req: Request, res: Response, next: NextFunction) => {
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
  handler: (req: Request, res: Response, next: NextFunction) => {
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
  handler: (req: Request, res: Response, next: NextFunction) => {
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

// Per-stream rate limiter for reconcile endpoint: 5 calls per stream per minute
const reconcileLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 5,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) => {
    // Use stream ID from params as the rate limit key
    return `reconcile:${req.params.id}`;
  },
  handler: (req: Request, res: Response, next: NextFunction) => {
    const resetTime = (req as any).rateLimit?.resetTime;
    const retryAfter = resetTime
      ? Math.ceil((resetTime.getTime() - Date.now()) / 1000)
      : 60;
    res.set("Retry-After", String(Math.max(1, retryAfter)));
    sendApiError(req, res, 429, "Too many reconcile requests for this stream. Please try again later.", {
      code: "RATE_LIMIT_EXCEEDED",
    });
  },
});

app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'none'"],
    },
  },
  hsts: {
    maxAge: 31536000,
    includeSubDomains: true,
    preload: true,
  },
}));
const ALLOWED_ORIGINS = process.env.ALLOWED_ORIGINS;

if (ALLOWED_ORIGINS) {
  const allowedOrigins = ALLOWED_ORIGINS.split(",").map((o) => o.trim());

  app.use((req, res, next) => {
    const origin = req.headers.origin;

    if (req.method === "OPTIONS" && req.headers["access-control-request-method"]) {
      if (!origin || !allowedOrigins.includes(origin)) {
        res.status(403).end();
        return;
      }
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
      res.setHeader("Access-Control-Allow-Methods", "GET,HEAD,PUT,PATCH,POST,DELETE");
      res.setHeader("Access-Control-Allow-Headers", req.headers["access-control-request-headers"] || "");
      res.setHeader("Content-Length", "0");
      res.status(204).end();
      return;
    }

    if (origin && allowedOrigins.includes(origin)) {
      res.setHeader("Access-Control-Allow-Origin", origin);
      res.setHeader("Vary", "Origin");
    }

    next();
  });
} else {
  app.use(cors());
}
app.use(requestLogger);
app.use(requireJsonContentType);
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

app.get("/api/docs/openapi.json", (_req: Request, res: Response) => {
  res.json(swaggerDocument);
});

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

app.get("/api/stats", async (_req: Request, res: Response) => {
  try {
    const stats = getGlobalStats();
    const onChainStreamCount = await getOnChainStreamCount();
    res.set("Cache-Control", "max-age=30");
    res.json({ data: { ...stats, onChainStreamCount, localStreamCount: stats.total } });
  } catch (error) {
    logger.error({ err: error }, "Failed to get stats");
    sendApiError(_req, res, 500, "Failed to compute stats.", { code: "INTERNAL_ERROR" });
  }
});

const METRICS_AUTH = process.env.METRICS_AUTH?.trim() || null; // format: "user:password"

app.get("/metrics", async (_req: Request, res: Response) => {
  if (METRICS_AUTH) {
    const authHeader = _req.headers.authorization;
    const expected = "Basic " + Buffer.from(METRICS_AUTH).toString("base64");
    if (!authHeader || authHeader !== expected) {
      res.setHeader("WWW-Authenticate", 'Basic realm="metrics"');
      res.status(401).send("Unauthorized");
      return;
    }
  }

  const output = await register.metrics();
  res.setHeader("Content-Type", "text/plain; version=0.0.4");
  res.send(output);
});

app.get("/api/metrics", authMiddleware, (_req: Request, res: Response) => {
  try {
    const metrics = getStreamMetrics();
    res.set("Cache-Control", "max-age=60");
    res.json({ data: metrics });
  } catch (error) {
    logger.error({ err: error }, "Failed to get stream metrics");
    sendApiError(_req, res, 500, "Failed to compute metrics.", {
      code: "INTERNAL_ERROR",
    });
  }
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
      logger.error({ err: error }, "failed to fetch metrics history");
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
    data: getAllowedAssets(),
  });
});

app.get("/api/admin/assets", adminJwtAuth, (_req: Request, res: Response) => {
  res.json({
    data: getAllowedAssets(),
  });
});

app.post("/api/admin/assets", adminJwtAuth, (req: Request, res: Response) => {
  const code = req.body?.code;
  if (typeof code !== "string" || !code.trim()) {
    sendApiError(req, res, 400, "Asset code is required.", { code: "VALIDATION_ERROR" });
    return;
  }
  const cleanCode = code.trim().toUpperCase();
  const ASSET_CODE_REGEX = /^[A-Za-z0-9]{1,12}$/;
  if (!ASSET_CODE_REGEX.test(cleanCode)) {
    sendApiError(req, res, 400, "Asset code must be 1–12 alphanumeric characters.", { code: "VALIDATION_ERROR" });
    return;
  }
  addAllowedAsset(cleanCode);
  res.json({
    data: getAllowedAssets(),
  });
});

app.delete("/api/admin/assets/:code", adminJwtAuth, (req: Request, res: Response) => {
  const { code } = req.params;
  if (!code) {
    sendApiError(req, res, 400, "Asset code is required.", { code: "VALIDATION_ERROR" });
    return;
  }
  const cleanCode = (code as string).trim().toUpperCase();
  removeAllowedAsset(cleanCode);
  res.json({
    data: getAllowedAssets(),
  });
});

app.post(["/api/admin/auth", "/api/auth/admin"], (req: Request, res: Response) => {
  const apiKey = req.body?.apiKey || req.header("X-Admin-Key");
  if (!apiKey || apiKey !== process.env.ADMIN_API_KEY) {
    sendApiError(req, res, 401, "Invalid Admin API Key.", { code: "UNAUTHORIZED" });
    return;
  }
  const token = jwt.sign({ role: "admin", accountId: "admin", isAdmin: true }, getJwtSecret(), { expiresIn: "24h" });
  res.json({ token });
});

app.get("/api/streams", readLimiter, async (req: Request, res: Response) => {
  const parsedQuery = listStreamsQuerySchema.safeParse(req.query);
  if (!parsedQuery.success) {
    sendValidationError(req, res, parsedQuery.error.issues);
    return;
  }

  const query = parsedQuery.data;
  const cacheKey = `streams:list:${JSON.stringify(query)}`;
  
  try {
    const cache = getCache();
    const cached = await cache.get<{ data: any[], total: number, page: number, limit: number }>(cacheKey);
    if (cached) {
      res.set("Cache-Control", "max-age=5");
      res.json(cached);
      return;
    }
  } catch {
    // If cache fails, just proceed without caching
  }

  const hasPage = req.query.page !== undefined;
  const hasLimit = req.query.limit !== undefined;

  const now = nowInSeconds();
  let data = listStreams(query.include_archived, query.sort ?? "createdAt", query.order ?? "desc").map((stream) => ({
    ...stream,
    progress: calculateProgress(stream, now),
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

  const result = {
    data: paginatedData,
    total,
    page,
    limit,
  };

  try {
    const cache = getCache();
    await cache.set(cacheKey, result, 5);
  } catch {
    // If cache fails, just proceed
  }

  res.set("Cache-Control", "max-age=5");
  res.json(result);
});

app.get("/api/streams/search", readLimiter, (req: Request, res: Response) => {
  const q = z.string().min(1, "search query must not be empty").safeParse(req.query.q);
  if (!q.success) {
    sendValidationError(req, res, q.error.issues);
    return;
  }

  try {
    const streamIds = searchStreamsFts(q.data);
    const now = nowInSeconds();
    const results = streamIds
      .map((id) => getStream(id))
      .filter((s) => s !== null)
      .map((s) => ({
        ...s,
        progress: calculateProgress(s!, now),
      }));

    res.set("Cache-Control", "max-age=5");
    res.json({
      data: results,
      total: results.length,
      query: q.data,
    });
  } catch (err) {
    logger.error({ err }, "search failed");
    sendApiError(req, res, 500, "Search failed.", { code: "SEARCH_ERROR" });
  }
});

app.get("/api/events", readLimiter, (req: Request, res: Response) => {
  const parsedQuery = listEventsQuerySchema.safeParse(req.query);
  if (!parsedQuery.success) {
    sendValidationError(req, res, parsedQuery.error.issues);
    return;
  }

  const query = parsedQuery.data;

  const eventType = query.eventType as StreamEventType | undefined;
  const streamId = query.streamId;
  const since = query.since;

  const total = countAllEvents(eventType, streamId, since);

  const page = query.page ?? PAGINATION_DEFAULT_PAGE;
  const pageSize = query.pageSize ?? query.limit ?? PAGINATION_DEFAULT_LIMIT;

  const offset = (page - 1) * pageSize;
  const data = getGlobalEvents(
    pageSize,
    offset,
    eventType,
    query.cursor,
    streamId,
    since,
  );

  res.json({ data, total, page, pageSize, limit: pageSize });
});

app.get(
  "/api/streams/export.csv",
  readLimiter,
  async (req: Request, res: Response) => {
    const parsedQuery = listStreamsQuerySchema.safeParse(req.query);
    if (!parsedQuery.success) {
      sendValidationError(req, res, parsedQuery.error.issues);
      return;
    }

    const query = parsedQuery.data;
    const cacheKey = `streams:export:${JSON.stringify(query)}`;
    
    try {
      const cache = getCache();
      const cached = await cache.get<string>(cacheKey);
      if (cached) {
        res.set("Cache-Control", "max-age=5");
        res.setHeader("Content-Type", "text/csv");
        res.setHeader("Content-Disposition", 'attachment; filename="export.csv"');
        res.send(cached);
        return;
      }
    } catch {
      // If cache fails, just proceed without caching
    }

    const now = nowInSeconds();
    let data = listStreams(query.include_archived).map((stream) => ({
      ...stream,
      progress: calculateProgress(stream, now),
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
    const csvContent = header + rows;

    try {
      const cache = getCache();
      await cache.set(cacheKey, csvContent, 5);
    } catch {
      // If cache fails, just proceed
    }

    res.set("Cache-Control", "max-age=5");
    res.setHeader("Content-Type", "text/csv");
    res.setHeader("Content-Disposition", 'attachment; filename="export.csv"');
    res.send(csvContent);
  },
);

const claimableBatchBodySchema = z.object({
  streamIds: z
    .array(z.string().regex(/^\d+$/, "Stream ID must be numeric"))
    .min(1, "At least one stream ID is required")
    .max(50, "Maximum 50 stream IDs per batch"),
});

app.post(
  "/api/streams/claimable/batch",
  claimableLimiter,
  async (req: Request, res: Response) => {
    const parsed = claimableBatchBodySchema.safeParse(req.body);
    if (!parsed.success) {
      sendValidationError(req, res, parsed.error.issues);
      return;
    }

    for (const streamId of parsed.data.streamIds) {
      const parsedId = parseStreamId(streamId);
      if (!parsedId.ok) {
        sendValidationError(req, res, parsedId.issues);
        return;
      }
      const stream = getStream(parsedId.value);
      if (!stream) {
        sendApiError(req, res, 404, `Stream ${streamId} not found.`, {
          code: "NOT_FOUND",
        });
        return;
      }
    }

    try {
      const { amounts, at } = await getOnChainClaimableBatch(parsed.data.streamIds);
      res.json({ amounts, at });
    } catch (error: unknown) {
      logger.error({ err: error }, "failed to simulate claimable batch");
      const normalizedError = normalizeUnknownApiError(
        error,
        "Failed to simulate claimable amounts.",
      );
      sendApiError(
        req,
        res,
        normalizedError.statusCode,
        normalizedError.message,
        { code: normalizedError.code ?? "INTERNAL_ERROR" },
      );
    }
  },
);

async function withAddressCache(
  key: string,
  fetcher: () => StreamRecord[],
): Promise<StreamRecord[]> {
  try {
    const cache = getCache();
    const cached = await cache.get<StreamRecord[]>(key);
    if (cached) return cached;
    const data = fetcher();
    await cache.set(key, data, 5);
    return data;
  } catch {
    return fetcher();
  }
}

app.get(
  "/api/streams/sender/:address",
  readLimiter,
  async (req: Request, res: Response) => {
    const parsedParams = senderAccountIdSchema.safeParse({
      accountId: req.params.address,
    });

    if (!parsedParams.success) {
      sendValidationError(req, res, parsedParams.error.issues);
      return;
    }

    const address = parsedParams.data.accountId;

    const parsedQuery = listStreamsQuerySchema.safeParse(req.query);
    if (!parsedQuery.success) {
      sendValidationError(req, res, parsedQuery.error.issues);
      return;
    }
    const query = parsedQuery.data;

    const rawStreams = await withAddressCache(
      `streams:sender:${address}`,
      () => listStreamsBySender(address, query.sort ?? "createdAt", query.order ?? "desc"),
    );

    const now = nowInSeconds();
    let data = rawStreams.map((stream) => ({
      ...stream,
      progress: calculateProgress(stream, now),
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
    if (query.assetCode && query.assetCode.length > 0) {
      data = data.filter((stream) =>
        query.assetCode!.includes(stream.assetCode.toUpperCase()),
      );
    }
    if (query.q && query.q.length > 0) {
      const searchTerm = query.q.toLowerCase();
      data = data.filter(
        (stream) =>
          stream.id.toLowerCase().includes(searchTerm) ||
          stream.sender.toLowerCase().includes(searchTerm) ||
          stream.recipient.toLowerCase().includes(searchTerm) ||
          stream.assetCode.toLowerCase().includes(searchTerm),
      );
    }
    if (query.minAmount !== undefined) {
      data = data.filter((stream) => stream.totalAmount >= query.minAmount!);
    }
    if (query.maxAmount !== undefined) {
      data = data.filter((stream) => stream.totalAmount <= query.maxAmount!);
    }

    const hasPage = req.query.page !== undefined;
    const hasLimit = req.query.limit !== undefined;

    const total = data.length;
    const page = query.page ?? PAGINATION_DEFAULT_PAGE;
    const limit =
      !hasPage && !hasLimit ? total : (query.limit ?? PAGINATION_DEFAULT_LIMIT);

    const offset = (page - 1) * limit;
    const paginatedData = data.slice(offset, offset + limit);

    res.json({ data: paginatedData, total, page, limit });
  },
);

app.get(
  "/api/streams/recipient/:address",
  readLimiter,
  async (req: Request, res: Response) => {
    const parsedParams = recipientAccountIdSchema.safeParse({
      accountId: req.params.address,
    });

    if (!parsedParams.success) {
      sendValidationError(req, res, parsedParams.error.issues);
      return;
    }

    const address = parsedParams.data.accountId;

    const parsedQuery = listStreamsQuerySchema.safeParse(req.query);
    if (!parsedQuery.success) {
      sendValidationError(req, res, parsedQuery.error.issues);
      return;
    }
    const query = parsedQuery.data;

    const rawStreams = await withAddressCache(
      `streams:recipient:${address}`,
      () => listStreamsByRecipient(address, query.sort ?? "createdAt", query.order ?? "desc"),
    );

    const now = nowInSeconds();
    let data = rawStreams.map((stream) => ({
      ...stream,
      progress: calculateProgress(stream, now),
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
    if (query.assetCode && query.assetCode.length > 0) {
      data = data.filter((stream) =>
        query.assetCode!.includes(stream.assetCode.toUpperCase()),
      );
    }
    if (query.q && query.q.length > 0) {
      const searchTerm = query.q.toLowerCase();
      data = data.filter(
        (stream) =>
          stream.id.toLowerCase().includes(searchTerm) ||
          stream.sender.toLowerCase().includes(searchTerm) ||
          stream.recipient.toLowerCase().includes(searchTerm) ||
          stream.assetCode.toLowerCase().includes(searchTerm),
      );
    }
    if (query.minAmount !== undefined) {
      data = data.filter((stream) => stream.totalAmount >= query.minAmount!);
    }
    if (query.maxAmount !== undefined) {
      data = data.filter((stream) => stream.totalAmount <= query.maxAmount!);
    }

    const hasPage = req.query.page !== undefined;
    const hasLimit = req.query.limit !== undefined;

    const total = data.length;
    const page = query.page ?? PAGINATION_DEFAULT_PAGE;
    const limit =
      !hasPage && !hasLimit ? total : (query.limit ?? PAGINATION_DEFAULT_LIMIT);

    const offset = (page - 1) * limit;
    const paginatedData = data.slice(offset, offset + limit);

    res.json({ data: paginatedData, total, page, limit });
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

app.get(
  "/api/recipients/:accountId/streams",
  readLimiter,
  (req: Request, res: Response) => {
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

    const now = nowInSeconds();
    let data = listStreamsByRecipient(accountId, query.sort ?? "createdAt", query.order ?? "desc").map((stream) => ({
      ...stream,
      progress: calculateProgress(stream, now),
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

    const now = nowInSeconds();
    let data = listStreamsBySender(accountId, query.sort ?? "createdAt", query.order ?? "desc").map((stream) => ({
      ...stream,
      progress: calculateProgress(stream, now),
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
  },
);

// GET /api/auth/challenge — returns a SEP-10 challenge transaction for the given accountId.
// The client must sign the transaction with their Stellar key (e.g. via Freighter)
// and submit it to POST /api/auth/token to receive a JWT.
// Challenge nonces expire after 60 seconds.
app.get("/api/auth/challenge", authChallengeLimiter, (req: Request, res: Response) => {
  const accountId = req.query.accountId;
  if (typeof accountId !== "string" || !accountId.trim()) {
    sendApiError(req, res, 400, "accountId query parameter is required.", {
      code: "VALIDATION_ERROR",
    });
    return;
  }

  try {
    const transaction = generateChallenge(accountId.trim());
    res.json({ transaction, network: process.env.NETWORK_PASSPHRASE || "Test SDF Network ; September 2015" });
  } catch (error: any) {
    logger.error({ err: error }, "failed to generate auth challenge");
    sendApiError(req, res, 500, "Failed to generate challenge.", {
      code: "INTERNAL_ERROR",
    });
  }
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
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : "Authentication failed.";
    sendApiError(req, res, 401, message, { code: "AUTH_ERROR" });
  }
});

// POST /api/auth/refresh â€” accepts a valid Bearer JWT, returns a new one with fresh 24h expiry
app.post("/api/auth/refresh", refreshToken);

app.post(
  "/api/streams/fee-estimate",
  mutationLimiter,
  authMiddleware,
  async (req: Request, res: Response) => {
    const currentAllowedAssets = getAllowedAssets();
    const parsedBody = createStreamPayloadWithAllowedAssetsSchema(
      currentAllowedAssets,
    ).safeParse(req.body);
    if (!parsedBody.success) {
      sendValidationError(req, res, parsedBody.error.issues);
      return;
    }

    try {
      const estimate = await estimateCreateStreamFee(parsedBody.data);
      res.json({ data: estimate });
    } catch (error: any) {
      logger.error({ err: error }, "failed to estimate stream creation fee");
      const normalizedError = normalizeUnknownApiError(
        error,
        "Failed to estimate network fee.",
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
  "/api/streams",
  mutationLimiter,
  authMiddleware,
  async (req: Request, res: Response) => {
    const currentAllowedAssets = getAllowedAssets();
    const parsedBody = createStreamPayloadWithAllowedAssetsSchema(
      currentAllowedAssets,
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
      logger.error({ err: error }, "failed to create stream");
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
      if (!updated) {
        sendApiError(req, res, 500, "Failed to cancel stream.", { code: "INTERNAL_ERROR" });
        return;
      }
      res.json({
        data: {
          ...updated,
          progress: calculateProgress(updated),
        },
      });
    } catch (error: any) {
      logger.error({ err: error, streamId: parsedId.value }, "failed to cancel stream");
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

// POST /api/streams/bulk-cancel â€” sender cancels multiple streams
app.post(
  "/api/streams/bulk-cancel",
  mutationLimiter,
  authMiddleware,
  async (req: Request, res: Response) => {
    const parsedBody = bulkCancelStreamsSchema.safeParse(req.body);
    if (!parsedBody.success) {
      sendValidationError(req, res, parsedBody.error.issues);
      return;
    }

    const { streamIds, sender } = parsedBody.data;
    const user = (req as any).user;

    // Verify the authenticated user matches the sender in the request body
    if (sender !== user.accountId) {
      sendApiError(req, res, 403, "Sender in request body does not match authenticated user.", {
        code: "FORBIDDEN",
      });
      return;
    }

    const canceled: string[] = [];
    const failed: { id: string; error: string }[] = [];

    // Cancel each stream serially to avoid SQLite lock contention
    for (const streamId of streamIds) {
      try {
        const stream = getStream(streamId);
        if (!stream) {
          failed.push({ id: streamId, error: "Stream not found" });
          continue;
        }

        if (stream.sender !== user.accountId) {
          failed.push({ id: streamId, error: "Only the sender can cancel this stream" });
          continue;
        }

        await cancelStream(streamId);
        canceled.push(streamId);
      } catch (error: any) {
        logger.error({ err: error, streamId }, "failed to cancel stream in bulk operation");
        failed.push({ id: streamId, error: "Failed to cancel stream" });
      }
    }

    res.json({ canceled, failed });
  },
);

// POST /api/streams/:id/pause â€” sender pauses an active stream
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

// POST /api/streams/:id/resume â€” sender resumes a paused stream
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

// POST /api/streams/:id/claim â€” recipient claims vested tokens
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

      // Guard against double-spend: check and write inside one atomic transaction.
      let alreadyClaimed = false;
      db.transaction(() => {
        const existing = db
          .prepare(
            `SELECT 1 FROM stream_events WHERE stream_id = ? AND event_type = 'claimed' LIMIT 1`,
          )
          .get(stream.id);
        if (existing) {
          alreadyClaimed = true;
          return;
        }
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

      if (alreadyClaimed) {
        sendApiError(req, res, 409, "Stream has already been claimed.", {
          code: "ALREADY_CLAIMED",
        });
        return;
      }

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
      logger.error({ err: error }, "failed to record claim");
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

// POST /api/streams/:id/reconcile — sync local state with on-chain state
app.post(
  "/api/streams/:id/reconcile",
  reconcileLimiter,
  authMiddleware,
  async (req: Request, res: Response) => {
    const parsedId = parseStreamId(req.params.id);
    if (!parsedId.ok) {
      sendValidationError(req, res, parsedId.issues);
      return;
    }

    try {
      const updated = await reconcileStream(parsedId.value);
      res.json({ data: { ...updated, progress: calculateProgress(updated) } });
    } catch (error: any) {
      logger.error({ err: error, streamId: parsedId.value }, "failed to reconcile stream");
      const normalizedError = normalizeUnknownApiError(
        error,
        "Failed to reconcile stream.",
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
  async (req: Request, res: Response) => {
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


    const parsedBody = updateStreamStartAtSchema.safeParse(req.body);
    if (!parsedBody.success) {
      sendValidationError(req, res, parsedBody.error.issues);
      return;
    }

    try {
      const updated = await updateStreamStartAt(parsedId.value, parsedBody.data.startAt);
      res.json({ data: { ...updated, progress: calculateProgress(updated) } });
    } catch (error: any) {
      const normalizedError = normalizeUnknownApiError(
        error,
        "Failed to update stream start time.",
      );
      sendApiError(
        req,
        res,
        normalizedError.statusCode,
        normalizedError.message,
        { code: normalizedError.code ?? "INTERNAL_ERROR" },
      );
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
    const page = Math.max(1, parseInt(req.query.page as string) || 1);
    const pageSize = Math.min(
      Math.max(1, parseInt(req.query.pageSize as string) || 20),
      100,
    );

    const total = countStreamEvents(parsedId.value);
    const offset = (page - 1) * pageSize;
    const data = getStreamHistory(parsedId.value, pageSize, offset);
    const hasMore = offset + pageSize < total;

    res.json({ data, total, page, pageSize, hasMore });
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
    const history = getStreamHistory(parsedId.value, 50, 0, 'asc');

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
    logger.error({ err: error }, "failed to fetch open issues from proxy");
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
      logger.error({ err: error }, "failed to fetch dead-letter webhooks");
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
      logger.error({ err: error }, "failed to count dead-letter webhooks");
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
    const id = parseInt(Array.isArray(req.params.id) ? req.params.id[0] : req.params.id, 10);
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
      logger.error({ err: error, deadLetterId: id }, "failed to re-queue dead-letter webhook");
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

app.delete(
  "/api/admin/webhooks/dead-letters",
  adminAuth,
  (req: Request, res: Response) => {
    try {
      const deleted = clearDeadLetters();
      res.json({
        success: true,
        deleted,
        message: "Webhook dead-letter queue cleared successfully",
      });
    } catch (error: any) {
      logger.error({ err: error }, "failed to clear webhook dead-letter queue");
      const normalizedError = normalizeUnknownApiError(
        error,
        "Failed to clear webhook dead-letter queue.",
      );
      sendApiError(
        req,
        res,
        normalizedError.statusCode,
        normalizedError.message,
        { code: normalizedError.code ?? "INTERNAL_ERROR" },
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
    startReconciliationJob(config.reconciliationIntervalMs);
  } else {
    logger.warn("CONTRACT_ID not set, event indexer will not start");
  }

  startArchiveJob(config.archiveCronIntervalMs);
  startDeadLetterPruningJob(config.webhookDeadLetterPruneIntervalMs);
  startStreamProgressBroadcaster(5000);

  const server = createServer(app);
  initWebSocket(server);

  server.listen(config.port, () => {
    logger.info({ port: config.port }, "StellarStream API listening with WebSocket support");
  });
}

if (require.main === module) {
  startServer().catch((err) => {
    logger.error({ err }, "failed to start server");
    process.exit(1);
  });
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
      sendApiError(req, res, 404, "Stream not found or already archived.", { code: "NOT_FOUND" });
      return;
    }

    res.status(204).send();
  } catch (error: any) {
    logger.error({ err: error, streamId: parsedId.value }, "failed to delete stream");
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
