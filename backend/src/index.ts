import cors from "cors";
import { requestLogger } from "./middleware/requestLogger";
import "dotenv/config";
import express, { Request, Response } from "express";
import swaggerUi from "swagger-ui-express";
import { z } from "zod";
import { swaggerDocument } from "./swagger";
import { fetchOpenIssues } from "./services/openIssues";
import {
  calculateProgress,
  cancelStream,
  createStream,
  getStream,
  initSoroban,
  listStreams,
  StreamStatus,
  syncStreams,
  updateStreamStartAt,
} from "./services/streamStore";
import {
  authMiddleware,
  generateChallenge,
  verifyChallengeAndIssueToken,
} from "./services/auth";
import {
  createStreamPayloadWithAllowedAssetsSchema,
  streamIdSchema,
  updateStreamStartAtSchema,
  zodIssuesToErrorMessage,
  zodIssuesToValidationIssues,
} from "./validation/schemas";

const STREAM_STATUSES: StreamStatus[] = [
  "scheduled",
  "active",
  "completed",
  "canceled",
];
const PAGINATION_DEFAULT_PAGE = 1;
const PAGINATION_DEFAULT_LIMIT = 20;
const PAGINATION_MAX_LIMIT = 100;

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
app.use(express.json());
app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(swaggerDocument));

function sendValidationError(res: Response, issues: z.ZodIssue[]) {
  res.status(400).json({
    error: zodIssuesToErrorMessage(issues),
    details: zodIssuesToValidationIssues(issues),
  });
}

function parseStreamId(streamIdRaw: string):
  | { ok: true; value: string }
  | { ok: false; issues: z.ZodIssue[] } {
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

app.get("/api/streams", (req: Request, res: Response) => {
  const parsedQuery = listStreamsQuerySchema.safeParse(req.query);
  if (!parsedQuery.success) {
    sendValidationError(res, parsedQuery.error.issues);
    return;
  }

  const query = parsedQuery.data;
  const hasPage = req.query.page !== undefined;
  const hasLimit = req.query.limit !== undefined;

  let data = listStreams().map((stream) => ({
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

app.get("/api/streams/export.csv", (req: Request, res: Response) => {
  let data = listStreams().map((stream) => ({
    ...stream,
    progress: calculateProgress(stream),
  }));

  const { status, asset, sender, recipient } = req.query;
  if (status && typeof status === "string") {
    data = data.filter((stream) => stream.progress.status === status);
  }
  if (asset && typeof asset === "string") {
    data = data.filter(
      (stream) => stream.assetCode.toLowerCase() === asset.toLowerCase(),
    );
  }
  if (sender && typeof sender === "string") {
    data = data.filter(
      (stream) => stream.sender.toLowerCase() === sender.toLowerCase(),
    );
  }
  if (recipient && typeof recipient === "string") {
    data = data.filter(
      (stream) => stream.recipient.toLowerCase() === recipient.toLowerCase(),
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
    sendValidationError(res, parsedId.issues);
    return;
  }

  const stream = getStream(parsedId.value);
  if (!stream) {
    res.status(404).json({ error: "Stream not found.", requestId: req.requestId });
    return;
  }
  res.json({ data: { ...stream, progress: calculateProgress(stream) } });
});

app.get("/api/auth/challenge", (req: Request, res: Response) => {
  const accountId = req.query.accountId;
  if (typeof accountId !== "string" || !accountId.trim()) {
    res.status(400).json({ error: "accountId query parameter is required." });
    return;
  }

  try {
    const challengeTransaction = generateChallenge(accountId.trim());
    res.json({ transaction: challengeTransaction });
  } catch (error: any) {
    console.error("Failed to generate challenge:", error);
    res.status(500).json({ error: "Failed to generate challenge transaction." });
  }
});

app.post("/api/auth/token", (req: Request, res: Response) => {
  const transaction = req.body?.transaction;
  if (typeof transaction !== "string" || !transaction.trim()) {
    res.status(400).json({ error: "transaction in body is required." });
    return;
  }

  try {
    const token = verifyChallengeAndIssueToken(transaction);
    res.json({ token });
  } catch (error: any) {
    res.status(401).json({ error: error.message, requestId: req.requestId });
  }
});


  }
});

app.post(
  "/api/streams/:id/cancel",
  authMiddleware,
  async (req: Request, res: Response) => {
    const parsedId = parseStreamId(req.params.id);
    if (!parsedId.ok) {
      sendValidationError(res, parsedId.issues);
      return;
    }

    try {
      const stream = await cancelStream(parsedId.value);
      if (!stream) {
        res.status(404).json({ error: "Stream not found.", requestId: req.requestId });
        return;
      }
      res.json({ data: { ...stream, progress: calculateProgress(stream) } });
    } catch (error: any) {
      console.error("Failed to cancel stream:", error);
      res.status(500).json({ error: error.message || "Failed to cancel stream." });
    }
  },
);

app.patch(
  "/api/streams/:id/start-time",
  authMiddleware,
  (req: Request, res: Response) => {
    const parsedId = parseStreamId(req.params.id);
    if (!parsedId.ok) {
      sendValidationError(res, parsedId.issues);
      return;
    }

    const parsedBody = updateStreamStartAtSchema.safeParse(req.body);
    if (!parsedBody.success) {
      sendValidationError(res, parsedBody.error.issues);
      return;
    }

    const newStartAt = parsedBody.data.startAt;
    if (newStartAt <= Math.floor(Date.now() / 1000)) {
      res.status(400).json({ error: "startAt must be in the future." });
      return;
    }

    try {
      const stream = updateStreamStartAt(parsedId.value, newStartAt);
      res.json({ data: { ...stream, progress: calculateProgress(stream) } });
    } catch (error: any) {
      const statusCode = error.statusCode ?? 500;
      res
        .status(statusCode)
        .json({ error: error.message || "Failed to update stream start time." });
    }
  },
);

app.get("/api/open-issues", async (_req: Request, res: Response) => {
  try {
    const data = await fetchOpenIssues();
    res.json({ data });
  } catch (error: any) {
    console.error("Failed to fetch open issues from proxy:", error);
    res.status(500).json({ error: error.message || "Failed to fetch open issues." });
  }
});


async function startServer() {
  await initSoroban();
  await syncStreams();
  
  // Initialize and start event indexer
  const rpcUrl = process.env.RPC_URL || "https://soroban-testnet.stellar.org:443";
  const contractId = process.env.CONTRACT_ID;
  const networkPassphrase = process.env.NETWORK_PASSPHRASE;
  
  if (contractId) {
    initIndexer(rpcUrl, contractId, networkPassphrase);
    startIndexer(10000); // Poll every 10 seconds
  } else {
    console.warn("CONTRACT_ID not set, event indexer will not start");
  }
  
  app.listen(port, () => {
    console.log(`StellarStream API listening on http://localhost:${port}`);
  });
}

if (require.main === module) {
  startServer().catch(console.error);
}
