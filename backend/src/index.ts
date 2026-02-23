import cors from "cors";
import "dotenv/config";
import express, { Request, Response } from "express";
import swaggerUi from "swagger-ui-express";
import { swaggerDocument } from "./swagger";
import { fetchOpenIssues } from "./services/openIssues";

import {
  calculateProgress,
  cancelStream,
  createStream,
  getStream,
  listStreams,
  initSoroban,
  syncStreams,
  updateStreamStartAt,
  StreamInput,
  StreamStatus,
} from "./services/streamStore";

const STREAM_STATUSES: StreamStatus[] = ["scheduled", "active", "completed", "canceled"];
const PAGINATION_DEFAULT_PAGE = 1;
const PAGINATION_DEFAULT_LIMIT = 20;
const PAGINATION_MAX_LIMIT = 100;

export const app = express();
const port = Number(process.env.PORT ?? 3001);
const ALLOWED_ASSETS = (process.env.ALLOWED_ASSETS || "USDC,XLM")
  .split(",")
  .map((a) => a.trim().toUpperCase());

app.use(cors());
app.use(express.json());

app.use("/api/docs", swaggerUi.serve, swaggerUi.setup(swaggerDocument));

function toNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }

  return null;
}


  if (!body || typeof body !== "object") {
    return { ok: false, message: "Body must be a JSON object." };
  }

  const payload = body as Record<string, unknown>;
  const sender =
    typeof payload.sender === "string" ? payload.sender.trim() : "";
  const recipient =
    typeof payload.recipient === "string" ? payload.recipient.trim() : "";
  const assetCodeRaw =
    typeof payload.assetCode === "string" ? payload.assetCode.trim() : "";
  const totalAmount = toNumber(payload.totalAmount);
  const durationSeconds = toNumber(payload.durationSeconds);
  const startAtValue =
    payload.startAt === undefined ? null : toNumber(payload.startAt);
  const assetCodeUpper = assetCodeRaw.toUpperCase();

  if (sender.length < 5 || recipient.length < 5) {
    return {
      ok: false,
      message: "Sender and recipient must look like valid Stellar account IDs.",
    };
  }

  if (assetCodeRaw.length < 2 || assetCodeRaw.length > 12) {
    return {
      ok: false,
      message: "assetCode must be between 2 and 12 characters.",
    };
  }

  // whitelist check
  if (!ALLOWED_ASSETS.includes(assetCodeUpper)) {
    return {
      ok: false,
      message: `Asset "${assetCodeRaw}" is not supported. Allowed assets: ${ALLOWED_ASSETS.join(", ")}.`,
    };
  }

  if (totalAmount === null || totalAmount <= 0) {
    return { ok: false, message: "totalAmount must be a positive number." };
  }

  if (durationSeconds === null || durationSeconds < 60) {
    return {
      ok: false,
      message: "durationSeconds must be at least 60 seconds.",
    };
  }

  if (startAtValue !== null && startAtValue <= 0) {
    return {
      ok: false,
      message: "startAt must be a valid UNIX timestamp in seconds.",
    };
  }

  return {
    ok: true,
    value: {
      sender,
      recipient,
      assetCode: assetCodeRaw.toUpperCase(),
      totalAmount,
      durationSeconds: Math.floor(durationSeconds),
      startAt: startAtValue === null ? undefined : Math.floor(startAtValue),
    },
  };
}

app.get("/api/health", (_req: Request, res: Response) => {
  res.json({
    service: "stellar-stream-backend",
    status: "ok",
    timestamp: new Date().toISOString(),
  });
});

app.get("/api/streams", (req: Request, res: Response) => {

});

app.get("/api/streams/export.csv", (req: Request, res: Response) => {
  let data = listStreams().map((stream) => ({
    ...stream,
    progress: calculateProgress(stream),
  }));

  const { status, asset, sender, recipient } = req.query;
  if (status) {
    data = data.filter((s) => s.progress.status === status);
  }
  if (asset) {
    data = data.filter(
      (s) => s.assetCode.toLowerCase() === (asset as string).toLowerCase(),
    );
  }
  if (sender) {
    data = data.filter(
      (s) => s.sender.toLowerCase() === (sender as string).toLowerCase(),
    );
  }
  if (recipient) {
    data = data.filter(
      (s) => s.recipient.toLowerCase() === (recipient as string).toLowerCase(),
    );
  }

  const header = "id,sender,recipient,asset,total,status,startAt\n";
  const rows = data
    .map((s) => {
      return `${s.id},${s.sender},${s.recipient},${s.assetCode},${s.totalAmount},${s.progress.status},${s.startAt}`;
    })
    .join("\n");

  res.setHeader("Content-Type", "text/csv");
  res.setHeader("Content-Disposition", 'attachment; filename="export.csv"');
  res.send(header + rows);
});

app.get("/api/streams/:id", (req: Request, res: Response) => {
  const stream = getStream(req.params.id);
  if (!stream) {
    res.status(404).json({ error: "Stream not found." });
    return;
  }
  res.json({ data: { ...stream, progress: calculateProgress(stream) } });
});

app.get("/api/auth/challenge", (req: Request, res: Response) => {
  const accountId = req.query.accountId as string;
  if (!accountId) {
    res.status(400).json({ error: "accountId query parameter is required." });
    return;
  }

  try {
    const challengeTransaction = generateChallenge(accountId);
    res.json({ transaction: challengeTransaction });
  } catch (error: any) {
    console.error("Failed to generate challenge:", error);
    res
      .status(500)
      .json({ error: "Failed to generate challenge transaction." });
  }
});

app.post("/api/auth/token", (req: Request, res: Response) => {
  const { transaction } = req.body;
  if (!transaction) {
    res.status(400).json({ error: "transaction in body is required." });
    return;
  }

  try {
    const token = verifyChallengeAndIssueToken(transaction);
    res.json({ token });
  } catch (error: any) {
    res.status(401).json({ error: error.message });
  }
});

app.post(
  "/api/streams",
  authMiddleware,
  async (req: Request, res: Response) => {
    const parsed = parseInput(req.body);
    if (!parsed.ok) {
      res.status(400).json({ error: parsed.message });
      return;
    }

    try {
      const stream = await createStream(parsed.value);
      res
        .status(201)
        .json({ data: { ...stream, progress: calculateProgress(stream) } });
    } catch (err: any) {
      console.error("Failed to create stream:", err);
      res
        .status(500)
        .json({ error: err.message || "Failed to create stream." });
    }
  },
);

app.post(
  "/api/streams/:id/cancel",
  authMiddleware,
  async (req: Request, res: Response) => {
    try {
      const stream = await cancelStream(req.params.id);
      if (!stream) {
        res.status(404).json({ error: "Stream not found." });
        return;
      }
      res.json({ data: { ...stream, progress: calculateProgress(stream) } });
    } catch (err: any) {
      console.error("Failed to cancel stream:", err);
      res
        .status(500)
        .json({ error: err.message || "Failed to cancel stream." });
    }
  },
);

app.patch(
  "/api/streams/:id/start-time",
  authMiddleware,
  (req: Request, res: Response) => {
    const newStartAt = toNumber(req.body?.startAt);

    if (newStartAt === null || newStartAt <= 0) {
      res
        .status(400)
        .json({ error: "startAt must be a valid UNIX timestamp in seconds." });
      return;
    }

    if (Math.floor(newStartAt) <= Math.floor(Date.now() / 1000)) {
      res.status(400).json({ error: "startAt must be in the future." });
      return;
    }

    try {
      const stream = updateStreamStartAt(req.params.id, Math.floor(newStartAt));
      res.json({
        data: {
          ...stream,
          progress: calculateProgress(stream),
        },
      });
    } catch (err: any) {
      const statusCode = (err as any).statusCode ?? 500;
      res
        .status(statusCode)
        .json({ error: err.message || "Failed to update stream start time." });
    }
  },
);

app.get("/api/open-issues", async (_req: Request, res: Response) => {
  try {
    const data = await fetchOpenIssues();
    res.json({ data });
  } catch (err: any) {
    console.error("Failed to fetch open issues from proxy:", err);
    res
      .status(500)
      .json({ error: err.message || "Failed to fetch open issues." });
  }
});


  await initSoroban();
  await syncStreams();
  app.listen(port, () => {
    console.log(`StellarStream API listening on http://localhost:${port}`);
  });
}

if (require.main === module) {
  startServer().catch(console.error);
}
