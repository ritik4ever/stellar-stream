import {
  Keypair,
  rpc,
  Contract,
  nativeToScVal,
  scValToNative,
  Address,
  TimeoutInfinite,
  TransactionBuilder,
  Networks,
  Account,
  xdr,
} from "@stellar/stellar-sdk";
import pLimit from "p-limit";
import { initDb, getDb, syncFtsIndex } from "./db";
import { recordEventWithDb } from "./eventHistory";
import { streamHasEvent } from "./eventHistory";
import { triggerWebhook } from "./webhook";
import { initCache, getCache } from "./cache";
import { resetStatsCache } from "./stats";
import { resetStreamMetricsCache } from "./streamMetrics";
import { logger } from "../logger";
import { retryWithBackoff, SorobanSubmitError } from "../utils/sorobanRetry";

export { SorobanSubmitError };

export type StreamStatus = "scheduled" | "active" | "paused" | "completed" | "canceled";

export interface StreamInput {
  sender: string;
  recipient: string;
  assetCode: string;
  totalAmount: number;
  durationSeconds: number;
  startAt?: number;
  cliffSeconds?: number;
}

export interface StreamFeeEstimate {
  feeStroops: number;
  feeXlm: string;
}

export interface StreamRecord {
  id: string;
  sender: string;
  recipient: string;
  assetCode: string;
  totalAmount: number;
  durationSeconds: number;
  startAt: number;
  createdAt: number;
  canceledAt?: number;
  completedAt?: number;
  refundedAmount?: number;
  pausedAt?: number;
  pausedDuration: number;
  cliffSeconds: number;
  metadata?: Record<string, string> | null;
}

export interface StreamProgress {
  status: StreamStatus;
  ratePerSecond: number;
  elapsedSeconds: number;
  vestedAmount: number;
  remainingAmount: number;
  percentComplete: number;
}

export type SortField = "totalAmount" | "startAt" | "createdAt" | "durationSeconds";
export type SortOrder = "asc" | "desc";

const SORT_COLUMNS: Record<SortField, string> = {
  totalAmount: "total_amount",
  startAt: "start_at",
  createdAt: "created_at",
  durationSeconds: "duration_seconds",
};

interface StreamRow {
  id: string;
  sender: string;
  recipient: string;
  asset_code: string;
  total_amount: number;
  duration_seconds: number;
  start_at: number;
  created_at: number;
  canceled_at: number | null;
  completed_at: number | null;
  refunded_amount: number | null;
  archived_at: number | null;
  paused_at: number | null;
  paused_duration: number;
  cliff_seconds: number;
  metadata: string | null;
}

function rowToRecord(row: StreamRow): StreamRecord {
  let metadata: Record<string, string> | null = null;
  if (row.metadata) {
    try {
      metadata = JSON.parse(row.metadata);
    } catch {
      metadata = null;
    }
  }
  return {
    id: row.id,
    sender: row.sender,
    recipient: row.recipient,
    assetCode: row.asset_code,
    totalAmount: row.total_amount,
    durationSeconds: row.duration_seconds,
    startAt: row.start_at,
    createdAt: row.created_at,
    canceledAt: row.canceled_at ?? undefined,
    completedAt: row.completed_at ?? undefined,
    refundedAmount: row.refunded_amount ?? undefined,
    pausedAt: row.paused_at ?? undefined,
    pausedDuration: row.paused_duration ?? 0,
    cliffSeconds: row.cliff_seconds ?? 0,
    metadata,
  };
}

function upsertStream(record: StreamRecord): void {
  const db = getDb();
  db.prepare(
    `
    INSERT INTO streams (id, sender, recipient, asset_code, total_amount, duration_seconds, start_at, created_at, canceled_at, completed_at, refunded_amount, archived_at, paused_at, paused_duration, cliff_seconds, metadata)
    VALUES (@id, @sender, @recipient, @assetCode, @totalAmount, @durationSeconds, @startAt, @createdAt, @canceledAt, @completedAt, @refundedAmount, @archivedAt, @pausedAt, @pausedDuration, @cliffSeconds, @metadata)
    ON CONFLICT(id) DO UPDATE SET
      sender = excluded.sender,
      recipient = excluded.recipient,
      asset_code = excluded.asset_code,
      total_amount = excluded.total_amount,
      duration_seconds = excluded.duration_seconds,
      start_at = excluded.start_at,
      created_at = excluded.created_at,
      canceled_at = excluded.canceled_at,
      completed_at = excluded.completed_at,
      refunded_amount = excluded.refunded_amount,
      archived_at = excluded.archived_at,
      paused_at = excluded.paused_at,
      paused_duration = excluded.paused_duration,
      cliff_seconds = excluded.cliff_seconds,
      metadata = excluded.metadata
  `,
  ).run({
    id: record.id,
    sender: record.sender,
    recipient: record.recipient,
    assetCode: record.assetCode,
    totalAmount: record.totalAmount,
    durationSeconds: record.durationSeconds,
    startAt: record.startAt,
    createdAt: record.createdAt,
    canceledAt: record.canceledAt ?? null,
    completedAt: record.completedAt ?? null,
    refundedAmount: record.refundedAmount ?? null,
    archivedAt: null,
    pausedAt: record.pausedAt ?? null,
    pausedDuration: record.pausedDuration ?? 0,
    cliffSeconds: record.cliffSeconds ?? 0,
    metadata: record.metadata ? JSON.stringify(record.metadata) : null,
  });
  syncFtsIndex(record.id, record.sender, record.recipient, record.assetCode);
}

function listLocalStreamIds(): Set<string> {
  const db = getDb();
  const rows = db.prepare("SELECT id FROM streams").all() as Array<{ id: string }>;
  return new Set(rows.map((row) => row.id));
}

let rpcServer: rpc.Server | null = null;
let serverKeypair: Keypair | null = null;

/**
 * Initializes Soroban RPC connection and database.
 * Must be called before any stream operations.
 * Reads RPC_URL and SERVER_PRIVATE_KEY from environment variables.
 * @throws {Error} If database initialization fails
 */
export async function initSoroban() {
  initDb();
  initCache();

  const rpcUrl =
    process.env.RPC_URL || "https://soroban-testnet.stellar.org:443";
  rpcServer = new rpc.Server(rpcUrl);

  if (process.env.SERVER_PRIVATE_KEY) {
    serverKeypair = Keypair.fromSecret(process.env.SERVER_PRIVATE_KEY);
  } else {
    logger.warn(
      "SERVER_PRIVATE_KEY missing. Creating streams on-chain will fail.",
    );
  }
}

export function nowInSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function round(value: number): number {
  return Number(value.toFixed(6));
}

interface CacheEntry<T> {
  data: T;
  expiresAt: number;
}

async function getCached<T>(key: string): Promise<T | null> {
  return getCache().get<T>(key);
}

async function setCached<T>(key: string, data: T, ttlSeconds = 5): Promise<void> {
  return getCache().set<T>(key, data, ttlSeconds);
}

async function invalidateCache(pattern?: string): Promise<void> {
  if (!pattern) {
    await getCache().clear();
  } else {
    await getCache().del(pattern);
  }
}


function getSorobanContext():
  | {
    contract: Contract;
    sourceAccountPromise: Promise<Account>;
  }
  | undefined {
  const contractId = process.env.CONTRACT_ID;
  if (!contractId || !rpcServer) {
    return undefined;
  }

  const pubKey = serverKeypair
    ? serverKeypair.publicKey()
    : "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";

  return {
    contract: new Contract(contractId),
    sourceAccountPromise: rpcServer.getAccount(pubKey),
  };
}

async function simulateContractCall(
  contract: Contract,
  sourceAccount: Account,
  method: string,
  ...args: any[]
): Promise<rpc.Api.SimulateTransactionResponse> {
  if (!rpcServer) {
    throw new Error("Soroban RPC server is not initialized.");
  }

  const tx = new TransactionBuilder(sourceAccount, {
    fee: "100",
    networkPassphrase: process.env.NETWORK_PASSPHRASE || Networks.TESTNET,
  })
    .addOperation(contract.call(method, ...args))
    .setTimeout(30)
    .build();

  return rpcServer.simulateTransaction(tx);
}

const STROOPS_PER_XLM = 10_000_000;

function formatStroopsAsXlm(stroops: number): string {
  return (stroops / STROOPS_PER_XLM).toFixed(7);
}

function createStreamOperation(contractId: string, input: StreamInput, startAt: number) {
  const endAt = startAt + input.durationSeconds;
  const fakeToken = contractId;

  return new Contract(contractId).call(
    "create_stream",
    new Address(input.sender).toScVal(),
    new Address(input.recipient).toScVal(),
    new Address(fakeToken).toScVal(),
    nativeToScVal(input.totalAmount, { type: "i128" }),
    nativeToScVal(startAt, { type: "u64" }),
    nativeToScVal(endAt, { type: "u64" }),
  );
}

function readSimulationFeeStroops(simRes: rpc.Api.SimulateTransactionResponse): number {
  const rawFee =
    (simRes as any).minResourceFee ??
    (simRes as any).feeCharged ??
    (simRes as any).result?.minResourceFee;
  const feeStroops = Number(rawFee);

  if (!Number.isFinite(feeStroops) || feeStroops < 0) {
    throw new Error("Soroban RPC simulation did not return a valid fee estimate.");
  }

  return feeStroops;
}

async function fetchNextOnChainStreamId(
  contract: Contract,
  sourceAccount: Account,
): Promise<number | null> {
  const simRes = await simulateContractCall(
    contract,
    sourceAccount,
    "get_next_stream_id",
  );

  if (!rpc.Api.isSimulationSuccess(simRes) || !simRes.result) {
    logger.warn({ simulation: simRes }, "failed to simulate get_next_stream_id");
    return null;
  }

  return Number(scValToNative(simRes.result.retval));
}

async function fetchOnChainStreamRecord(
  contract: Contract,
  sourceAccount: Account,
  id: number,
  bypassCache = false,
): Promise<StreamRecord | null> {
  const cacheKey = `stream:${id}`;
  if (!bypassCache) {
    const cached = await getCached<StreamRecord>(cacheKey);
    if (cached) {
      return cached;
    }
  }

  const simRes = await simulateContractCall(
    contract,
    sourceAccount,
    "get_stream",
    nativeToScVal(id, { type: "u64" }),
  );

  if (!rpc.Api.isSimulationSuccess(simRes) || !simRes.result) {
    return null;
  }

  const streamData = scValToNative(simRes.result.retval);

  let metadata: Record<string, string> | null = null;
  if (streamData.metadata) {
    try {
      const rawMeta = streamData.metadata;
      if (rawMeta instanceof Map) {
        metadata = {};
        for (const [k, v] of rawMeta.entries()) {
          metadata[String(k)] = String(v);
        }
      } else if (typeof rawMeta === "object") {
        metadata = {};
        for (const [k, v] of Object.entries(rawMeta as Record<string, unknown>)) {
          metadata[String(k)] = String(v);
        }
      }
    } catch {
      metadata = null;
    }
  }

  const result: StreamRecord = {
    id: id.toString(),
    sender: streamData.sender,
    recipient: streamData.recipient,
    assetCode: streamData.token,
    totalAmount: Number(streamData.total_amount),
    durationSeconds: Number(streamData.end_time) - Number(streamData.start_time),
    startAt: Number(streamData.start_time),
    createdAt: Number(streamData.start_time),
    canceledAt: streamData.canceled ? nowInSeconds() : undefined,
    pausedAt: streamData.paused_at ? Number(streamData.paused_at) : undefined,
    pausedDuration: Number(streamData.paused_duration ?? 0),
    cliffSeconds: Number(streamData.cliff_seconds ?? 0),
    metadata,
  };

  await setCached(cacheKey, result, 5);
  return result;
}

function recordBackfilledCreatedEvent(stream: StreamRecord): void {
  if (streamHasEvent(stream.id, "created")) {
    return;
  }

  const db = getDb();
  db.transaction(() => {
    recordEventWithDb(
      db,
      stream.id,
      "created",
      stream.createdAt,
      stream.sender,
      stream.totalAmount,
      {
        recipient: stream.recipient,
        assetCode: stream.assetCode,
        durationSeconds: stream.durationSeconds,
        source: "reconciliation",
      },
    );
  })();
}

function computeStatus(stream: StreamRecord, at: number): StreamStatus {
  if (stream.canceledAt !== undefined) {
    return "canceled";
  }
  if (stream.completedAt !== undefined) {
    return "completed";
  }
  if (stream.pausedAt !== undefined) {
    return "paused";
  }
  if (at < stream.startAt) {
    return "scheduled";
  }
  if (at >= stream.startAt + stream.durationSeconds + stream.pausedDuration) {
    return "completed";
  }
  return "active";
}

/**
 * Calculates the current progress of a stream.
 * Accounts for paused duration and cancellation state.
 * @param {StreamRecord} stream - The stream to calculate progress for
 * @param {number} [at=nowInSeconds()] - Unix timestamp to calculate progress at (defaults to current time)
 * @returns {StreamProgress} Progress metrics including status, vested amount, and percentage complete
 */
export function calculateProgress(
  stream: StreamRecord,
  at = nowInSeconds(),
): StreamProgress {
  const streamEnd = stream.startAt + stream.durationSeconds;

  // When paused, vesting is frozen at the moment of pause.
  const effectiveAt =
    stream.pausedAt !== undefined ? Math.min(at, stream.pausedAt) : at;

  const elapsed = Math.max(0, Math.min(effectiveAt - stream.startAt - stream.pausedDuration, stream.durationSeconds));

  const ratio = Math.min(1, elapsed / stream.durationSeconds);
  const elapsed = Math.max(0, Math.max(0, effectiveAt - stream.startAt) - stream.pausedDuration);
  const ratio = stream.durationSeconds <= 0 ? 1 : Math.min(1, elapsed / stream.durationSeconds);
  const elapsedSeconds = stream.durationSeconds <= 0 ? 0 : Math.min(elapsed, stream.durationSeconds);
  const vestedAmount = stream.totalAmount * ratio;

  return {
    status: computeStatus(stream, at),
    ratePerSecond: stream.durationSeconds <= 0 ? Infinity : round(stream.totalAmount / stream.durationSeconds),
    elapsedSeconds,
    vestedAmount: round(vestedAmount),
    remainingAmount: round(Math.max(0, stream.totalAmount - vestedAmount)),
    percentComplete: round(ratio * 100),
  };
}

export async function getOnChainClaimableAmount(
  id: string,
): Promise<{ claimableAmount: number; at: number }> {
  const sorobanContext = getSorobanContext();
  if (!sorobanContext || !rpcServer) {
    throw new Error("Soroban RPC server is not initialized.");
  }

  const sourceAccount = await sorobanContext.sourceAccountPromise;
  const latestLedger = await rpcServer.getLatestLedger() as any;
  const at = latestLedger.timestamp ? parseInt(latestLedger.timestamp, 10) : Math.floor(Date.now() / 1000);

  const simRes = await simulateContractCall(
    sorobanContext.contract,
    sourceAccount,
    "claimable",
    nativeToScVal(parseInt(id), { type: "u64" }),
    nativeToScVal(at, { type: "u64" }),
  );

  if (!rpc.Api.isSimulationSuccess(simRes) || !simRes.result) {
    throw new Error("Simulation failed: " + JSON.stringify(simRes));
  }

  const claimableAmount = Number(scValToNative(simRes.result.retval));
  return { claimableAmount, at };
}

const MAX_CLAIMABLE_BATCH_SIZE = 50;

function parseClaimableBatchMap(native: unknown): Record<string, number> {
  const result: Record<string, number> = {};
  if (native instanceof Map) {
    for (const [key, value] of native.entries()) {
      result[String(key)] = Number(value);
    }
    return result;
  }
  if (native && typeof native === "object") {
    for (const [key, value] of Object.entries(native as Record<string, unknown>)) {
      result[String(key)] = Number(value);
    }
  }
  return result;
}

async function getOnChainClaimableBatchChunk(
  ids: string[],
  at: number,
  contract: Contract,
  sourceAccount: Account,
): Promise<{ amounts: Record<string, number> }> {
  if (ids.length === 0) {
    return { amounts: {} };
  }

  const streamIdVec = xdr.ScVal.scvVec(
    ids.map((id) => nativeToScVal(parseInt(id, 10), { type: "u64" })),
  );

  const simRes = await simulateContractCall(
    contract,
    sourceAccount,
    "get_claimable_batch",
    streamIdVec,
    nativeToScVal(at, { type: "u64" }),
  );

  if (!rpc.Api.isSimulationSuccess(simRes) || !simRes.result) {
    throw new Error("Simulation failed: " + JSON.stringify(simRes));
  }

  const amounts = parseClaimableBatchMap(scValToNative(simRes.result.retval));
  return { amounts };
}

export async function getOnChainClaimableBatch(
  ids: string[],
): Promise<{ amounts: Record<string, number>; at: number }> {
  if (ids.length === 0) {
    const at = await getLatestLedgerTime();
    return { amounts: {}, at };
  }

  const sorobanContext = getSorobanContext();
  if (!sorobanContext || !rpcServer) {
    throw new Error("Soroban RPC server is not initialized.");
  }

  const sourceAccount = await sorobanContext.sourceAccountPromise;
  const latestLedger = await rpcServer.getLatestLedger() as any;
  const at = latestLedger.timestamp
    ? parseInt(latestLedger.timestamp, 10)
    : Math.floor(Date.now() / 1000);

  // Split into chunks of MAX_CLAIMABLE_BATCH_SIZE
  const chunks: string[][] = [];
  for (let i = 0; i < ids.length; i += MAX_CLAIMABLE_BATCH_SIZE) {
    chunks.push(ids.slice(i, i + MAX_CLAIMABLE_BATCH_SIZE));
  }

  const allAmounts: Record<string, number> = {};
  const limit = pLimit(5);
  await Promise.all(
    chunks.map((chunk) =>
      limit(async () => {
        const { amounts } = await getOnChainClaimableBatchChunk(
          chunk,
          at,
          sorobanContext.contract,
          sourceAccount,
        );
        Object.assign(allAmounts, amounts);
      }),
    ),
  );

  return { amounts: allAmounts, at };
}

export async function getLatestLedgerTime(): Promise<number> {
  if (!rpcServer) {
    return Math.floor(Date.now() / 1000);
  }
  try {
    const latestLedger = await rpcServer.getLatestLedger() as any;
    return latestLedger.timestamp ? parseInt(latestLedger.timestamp, 10) : Math.floor(Date.now() / 1000);
  } catch (e) {
    return Math.floor(Date.now() / 1000);
  }
}

export async function getOnChainStreamCount(): Promise<number | null> {
  const sorobanContext = getSorobanContext();
  if (!sorobanContext || !rpcServer) {
    return null;
  }
  try {
    const sourceAccount = await sorobanContext.sourceAccountPromise;
    const simRes = await simulateContractCall(
      sorobanContext.contract,
      sourceAccount,
      "get_stream_count",
    );
    if (!rpc.Api.isSimulationSuccess(simRes) || !simRes.result) {
      logger.warn({ simulation: simRes }, "failed to simulate get_stream_count");
      return null;
    }
    return Number(scValToNative(simRes.result.retval));
  } catch (err) {
    logger.warn({ err }, "get_stream_count RPC call failed");
    return null;
  }
}

export async function syncStreams() {
  const sorobanContext = getSorobanContext();
  if (!sorobanContext) return;

  const syncStart = Date.now();

  try {
    const sourceAccount = await sorobanContext.sourceAccountPromise;
    const nextId = await fetchNextOnChainStreamId(
      sorobanContext.contract,
      sourceAccount,
    );
    if (nextId === null) return;

    const ids = Array.from({ length: nextId - 1 }, (_, i) => i + 1);

    // Concurrency-limited parallel fetch â€” max 5 simultaneous RPC calls.
    // Falls back to sequential per-stream if the parallel pass throws.
    const limit = pLimit(5);
    let parallelFailed = false;

    try {
      await Promise.all(
        ids.map((id) =>
          limit(async () => {
            const stream = await fetchOnChainStreamRecord(
              sorobanContext.contract,
              sourceAccount,
              id,
            );
            if (stream) upsertStream(stream);
          }),
        ),
      );
    } catch (err) {
      logger.warn({ err }, "parallel stream sync failed, falling back to sequential");
      parallelFailed = true;
    }

    if (parallelFailed) {
      for (const id of ids) {
        try {
          const stream = await fetchOnChainStreamRecord(
            sorobanContext.contract,
            sourceAccount,
            id,
          );
          if (stream) upsertStream(stream);
        } catch (e) {
          logger.error({ err: e, streamId: id }, "failed to fetch stream sequentially");
        }
      }
    }

    const elapsed = Date.now() - syncStart;
    logger.info({ elapsedMs: elapsed, streamCount: ids.length }, "stream sync completed");
  } catch (err) {
    logger.error({ err }, "failed to sync streams");
  }
}

/**
 * Reconciles a single stream's on-chain state with local SQLite.
 * Forces an immediate Soroban get_stream call and updates the local record.
 * @async
 * @param {string} streamId - The stream ID to reconcile
 * @returns {Promise<StreamRecord>} The updated stream record
 * @throws {Error} If stream not found on-chain or Soroban not configured
 */
export async function reconcileStream(streamId: string): Promise<StreamRecord> {
  const sorobanContext = getSorobanContext();
  if (!sorobanContext) {
    throw new Error("Soroban not configured");
  }

  const id = Number(streamId);
  if (isNaN(id) || id <= 0) {
    throw new Error("Invalid stream ID");
  }

  try {
    const sourceAccount = await sorobanContext.sourceAccountPromise;
    const onChainStream = await fetchOnChainStreamRecord(
      sorobanContext.contract,
      sourceAccount,
      id,
      true, // bypass cache to force fresh Soroban call
    );

    if (!onChainStream) {
      throw new Error("Stream not found on-chain");
    }

    // Update local SQLite with on-chain state
    upsertStream(onChainStream);

    logger.info({ streamId }, "stream reconciled with on-chain state");
    return onChainStream;
  } catch (err) {
    logger.error({ err, streamId }, "failed to reconcile stream");
    throw err;
  }
}

/**
 * Reconciles missing streams by comparing local database with on-chain state.
 * Backfills any streams that exist on-chain but not locally.
 * Records "created" events for backfilled streams.
 * @async
 * @returns {Promise<number>} Number of streams repaired
 */
export async function reconcileMissingStreams(): Promise<number> {
  const sorobanContext = getSorobanContext();
  if (!sorobanContext) {
    return 0;
  }

  try {
    const sourceAccount = await sorobanContext.sourceAccountPromise;
    const nextId = await fetchNextOnChainStreamId(
      sorobanContext.contract,
      sourceAccount,
    );

    if (nextId === null || nextId <= 1) {
      logger.info("no on-chain streams available to reconcile");
      return 0;
    }

    const localStreamIds = listLocalStreamIds();
    const missingIds: number[] = [];

    for (let id = 1; id < nextId; id++) {
      if (!localStreamIds.has(id.toString())) {
        missingIds.push(id);
      }
    }

    if (missingIds.length === 0) {
      logger.info("no missing local streams detected");
      return 0;
    }

    logger.warn({ missingCount: missingIds.length, missingIds }, "missing local streams detected");

    let repairedCount = 0;
    for (const missingId of missingIds) {
      try {
        const stream = await fetchOnChainStreamRecord(
          sorobanContext.contract,
          sourceAccount,
          missingId,
        );

        if (!stream) {
          logger.error({ streamId: missingId }, "missing stream could not be fetched from chain");
          continue;
        }

        upsertStream(stream);
        recordBackfilledCreatedEvent(stream);
        repairedCount += 1;
      } catch (err) {
        logger.error({ err, streamId: missingId }, "failed to backfill missing stream");
      }
    }

    logger.info({ repairedCount, missingCount: missingIds.length }, "missing local streams repaired");
    return repairedCount;
  } catch (err) {
    logger.error({ err }, "reconciliation failed");
    return 0;
  }
}

/**
 * Creates a new stream on-chain and persists it locally.
 * Sends transaction to Soroban contract and records "created" event.
 * Triggers webhook notification after successful persistence.
 * @async
 * @param {StreamInput} input - Stream creation parameters (sender, recipient, amount, duration, etc.)
 * @returns {Promise<StreamRecord>} The created stream record
 * @throws {Error} If Soroban is not configured or transaction fails
 */
export async function createStream(input: StreamInput): Promise<StreamRecord> {
  const startAt = input.startAt ?? nowInSeconds();
  const contractId = process.env.CONTRACT_ID;
  const netPass =
    process.env.NETWORK_PASSPHRASE || "Test SDF Network ; September 2015";

  if (!contractId || !rpcServer || !serverKeypair) {
    throw new Error("Backend not configured for Soroban.");
  }

  const sourceAccount = await rpcServer.getAccount(serverKeypair.publicKey());
  const tx = createStreamOperation(contractId, input, startAt);

  // We have to build and send this tx. Wait, doing this properly via building is long:
  const built = await rpcServer.prepareTransaction(
    new TransactionBuilder(sourceAccount, {
      fee: "1000",
      networkPassphrase: netPass,
    })
      .addOperation(tx)
      .setTimeout(30)
      .build(),
  );

  built.sign(serverKeypair);

  const sendRes = await retryWithBackoff(() => rpcServer!.sendTransaction(built));
  if (sendRes.status !== "PENDING") {
    throw new Error("Failed to send transaction: " + JSON.stringify(sendRes));
  }

  let txResult;
  let attempts = 0;
  while (attempts < 10) {
    txResult = await retryWithBackoff(() => rpcServer!.getTransaction(sendRes.hash));
    if (txResult.status !== "NOT_FOUND") break;
    await new Promise((r) => setTimeout(r, 1000));
    attempts++;
  }

  if (txResult?.status !== "SUCCESS" || !txResult.returnValue) {
    throw new Error("Tx failed on chain: " + JSON.stringify(txResult));
  }

  const streamIdVal = scValToNative(txResult.returnValue);
  const streamIdStr = streamIdVal.toString();

  const stream: StreamRecord = {
    id: streamIdStr,
    sender: input.sender,
    recipient: input.recipient,
    assetCode: input.assetCode.toUpperCase(),
    totalAmount: input.totalAmount,
    durationSeconds: input.durationSeconds,
    startAt,
    createdAt: nowInSeconds(),
    pausedDuration: 0,
    cliffSeconds: input.cliffSeconds ?? 0,
  };

  // Atomically write the stream row and the creation event.
  const db = getDb();
  db.transaction(() => {
    upsertStream(stream);
    recordEventWithDb(
      db,
      streamIdStr,
      "created",
      stream.createdAt,
      input.sender,
      input.totalAmount,
      {
        recipient: input.recipient,
        assetCode: input.assetCode,
        durationSeconds: input.durationSeconds,
      },
    );
  })();

  // Invalidate cache to ensure freshness after stream creation
  await invalidateCache("stream:");
  await invalidateCache("streams:list:");
  await invalidateCache("streams:export:");
  resetStatsCache();
  resetStreamMetricsCache();

  // Webhook fires after the transaction commits â€” a webhook failure
  // must never roll back an already-persisted stream.
  triggerWebhook("created", stream);
  return stream;
}

export async function estimateCreateStreamFee(input: StreamInput): Promise<StreamFeeEstimate> {
  const startAt = input.startAt ?? nowInSeconds();
  const contractId = process.env.CONTRACT_ID;
  const netPass =
    process.env.NETWORK_PASSPHRASE || "Test SDF Network ; September 2015";

  if (!contractId || !rpcServer || !serverKeypair) {
    throw new Error("Backend not configured for Soroban.");
  }

  const sourceAccount = await rpcServer.getAccount(serverKeypair.publicKey());
  const tx = new TransactionBuilder(sourceAccount, {
    fee: "1000",
    networkPassphrase: netPass,
  })
    .addOperation(createStreamOperation(contractId, input, startAt))
    .setTimeout(30)
    .build();

  const simRes = await rpcServer.simulateTransaction(tx);
  if (!rpc.Api.isSimulationSuccess(simRes)) {
    throw new Error("Soroban RPC simulation failed.");
  }

  const feeStroops = readSimulationFeeStroops(simRes);
  return {
    feeStroops,
    feeXlm: formatStroopsAsXlm(feeStroops),
  };
}


export function refreshStreamStatuses(): number {
  const db = getDb();
  const now = nowInSeconds();


  const toComplete = db.prepare(`
    SELECT * FROM streams 
    WHERE canceled_at IS NULL AND completed_at IS NULL AND paused_at IS NULL
      AND (start_at + duration_seconds) <= ?
  `).all() as StreamRow[];


  const result = db.prepare(`
    UPDATE streams SET completed_at = ?
    WHERE canceled_at IS NULL AND completed_at IS NULL AND paused_at IS NULL
      AND (start_at + duration_seconds) <= ?
  `).run(now, now);


  toComplete.forEach(row => {
    const record = rowToRecord(row);

    record.completedAt = now;

    // Record stream_completed event if not already recorded
    if (!streamHasEvent(record.id, "completed")) {
      recordEventWithDb(db, record.id, "completed", now);
    }

    triggerWebhook("completed", record);
  });

  return result.changes;
}

/**
 * Archives completed streams older than 30 days.
 * Moves archived streams to stream_archive table and marks them in main table.
 * @async
 * @returns {Promise<number>} Number of streams archived
 */
export async function archiveOldStreams(): Promise<number> {
  const db = getDb();
  const thirtyDaysAgo = nowInSeconds() - 30 * 24 * 60 * 60;

  try {
    // Find completed streams older than 30 days that haven't been archived yet
    const streamsToArchive = db
      .prepare(
        `
      SELECT * FROM streams
      WHERE completed_at IS NOT NULL
        AND completed_at < ?
        AND archived_at IS NULL
    `,
      )
      .all(thirtyDaysAgo) as StreamRow[];

    if (streamsToArchive.length === 0) {
      return 0;
    }

    const now = nowInSeconds();
    let archived = 0;

    db.transaction(() => {
      for (const row of streamsToArchive) {
        const record = rowToRecord(row);
        record.refundedAmount = row.refunded_amount ?? undefined;

        // Insert into archive
        db.prepare(
          `
        INSERT INTO stream_archive (id, sender, recipient, asset_code, total_amount, duration_seconds, start_at, created_at, canceled_at, completed_at, refunded_amount, archived_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `,
        ).run(
          record.id,
          record.sender,
          record.recipient,
          record.assetCode,
          record.totalAmount,
          record.durationSeconds,
          record.startAt,
          record.createdAt,
          record.canceledAt ?? null,
          record.completedAt ?? null,
          record.refundedAmount ?? null,
          now,
        );

        // Mark as archived in main table
        db.prepare("UPDATE streams SET archived_at = ? WHERE id = ?").run(now, record.id);
        archived++;
      }
    })();

    logger.info({ archived }, "completed streams archived");
    return archived;
  } catch (err) {
    logger.error({ err }, "failed to archive old streams");
    return 0;
  }
}

/**
 * Builds the ORDER BY clause for a sort field and order direction.
 * Uses a whitelist of allowed column names to prevent SQL injection.
 */
function buildOrderClause(sort: SortField, order: SortOrder): string {
  const column = SORT_COLUMNS[sort];
  const dir = order === "asc" ? "ASC" : "DESC";
  return `ORDER BY ${column} ${dir}`;
}

/**
 * Lists all streams from the database.
 * @param {boolean} [includeArchived=false] - Whether to include archived streams
 * @param {SortField} [sort="createdAt"] - Field to sort by
 * @param {SortOrder} [order="desc"] - Sort direction
 * @returns {StreamRecord[]} Array of stream records sorted by the specified field
 */
export function listStreams(includeArchived = false, sort: SortField = "createdAt", order: SortOrder = "desc"): StreamRecord[] {
  const db = getDb();
  const orderClause = buildOrderClause(sort, order);
  const query = includeArchived
    ? `SELECT * FROM streams ${orderClause}`
    : `SELECT * FROM streams WHERE archived_at IS NULL ${orderClause}`;
  const rows = db.prepare(query).all() as StreamRow[];
  return rows.map(rowToRecord);
}

/**
 * Lists all streams where the given address is the recipient.
 * @param {string} recipientAddress - Stellar account address to filter by
 * @param {SortField} [sort="createdAt"] - Field to sort by
 * @param {SortOrder} [order="desc"] - Sort direction
 * @returns {StreamRecord[]} Array of stream records sorted by the specified field
 */
export function listStreamsByRecipient(recipientAddress: string, sort: SortField = "createdAt", order: SortOrder = "desc"): StreamRecord[] {
  const db = getDb();
  const orderClause = buildOrderClause(sort, order);
  const rows = db
    .prepare(`SELECT * FROM streams WHERE recipient = ? ${orderClause}`)
    .all(recipientAddress) as StreamRow[];
  return rows.map(rowToRecord);
}

/**
 * Lists all streams where the given address is the sender.
 * @param {string} senderAddress - Stellar account address to filter by
 * @param {SortField} [sort="createdAt"] - Field to sort by
 * @param {SortOrder} [order="desc"] - Sort direction
 * @returns {StreamRecord[]} Array of stream records sorted by the specified field
 */
export function listStreamsBySender(senderAddress: string, sort: SortField = "createdAt", order: SortOrder = "desc"): StreamRecord[] {
  const db = getDb();
  const orderClause = buildOrderClause(sort, order);
  const rows = db
    .prepare(`SELECT * FROM streams WHERE sender = ? ${orderClause}`)
    .all(senderAddress) as StreamRow[];
  return rows.map(rowToRecord);
}

/**
 * Retrieves a single stream by ID.
 * @param {string} id - Stream ID
 * @returns {StreamRecord | undefined} The stream record, or undefined if not found
 */
export function getStream(id: string): StreamRecord | undefined {
  const db = getDb();
  const row = db.prepare("SELECT * FROM streams WHERE id = ?").get(id) as
    | StreamRow
    | undefined;
  return row ? rowToRecord(row) : undefined;
}

/**
 * Cancels a stream and records the cancellation event.
 * Attempts to retrieve refund amount from on-chain cancel transaction.
 * Triggers webhook notification after successful cancellation.
 * @async
 * @param {string} id - Stream ID to cancel
 * @returns {Promise<StreamRecord | undefined>} The updated stream record, or undefined if not found
 */
export async function cancelStream(
  id: string,
): Promise<StreamRecord | undefined> {
  const stream = getStream(id);
  if (!stream || stream.canceledAt !== undefined) {
    return stream;
  }

  stream.canceledAt = nowInSeconds();

  // Attempt to get refund amount from on-chain cancel transaction.
  // For now, we extract from potential on-chain response. In production,
  // this would send an actual cancel_stream transaction to the contract.
  try {
    const sorobanContext = getSorobanContext();
    if (sorobanContext && rpcServer && serverKeypair) {
      const contractId = process.env.CONTRACT_ID;
      if (contractId) {
        const sourceAccount = await rpcServer.getAccount(serverKeypair.publicKey());
        const contract = new Contract(contractId);
        const tx = contract.call(
          "cancel_stream",
          nativeToScVal(parseInt(id), { type: "u64" }),
        );

        const built = await rpcServer.prepareTransaction(
          new TransactionBuilder(sourceAccount, {
            fee: "1000",
            networkPassphrase: process.env.NETWORK_PASSPHRASE || Networks.TESTNET,
          })
            .addOperation(tx)
            .setTimeout(30)
            .build(),
        );

        built.sign(serverKeypair);
        const sendRes = await retryWithBackoff(() => rpcServer!.sendTransaction(built));
        if (sendRes.status === "PENDING") {
          let txResult;
          let attempts = 0;
          while (attempts < 10) {
            txResult = await retryWithBackoff(() =>
              rpcServer!.getTransaction(sendRes.hash),
            );
            if (txResult.status !== "NOT_FOUND") break;
            await new Promise((r) => setTimeout(r, 1000));
            attempts++;
          }

          if (txResult?.status === "SUCCESS" && txResult.returnValue) {
            stream.refundedAmount = Number(scValToNative(txResult.returnValue));
          }
        }
      }
    }
  } catch (err) {
    logger.warn({ err, streamId: id }, "failed to get refund amount from chain");
  }

  // Invalidate cache
  await invalidateCache(`stream:${id}`);
  await invalidateCache("streams:list:");
  await invalidateCache("streams:export:");
  resetStatsCache();
  resetStreamMetricsCache();

  // Atomically write the updated stream row and the cancellation event.
  const db = getDb();
  db.transaction(() => {
    upsertStream(stream);
    recordEventWithDb(db, stream.id, "canceled", stream.canceledAt!, stream.sender);
  })();

  // Webhook fires after the transaction commits.
  triggerWebhook("canceled", stream);
  return stream;
}


/**
 * Updates the start time of a scheduled stream.
 * Only scheduled streams (not yet started) can have their start time updated.
 * Records "start_time_updated" event.
 * @param {string} id - Stream ID
 * @param {number} newStartAt - New start time (Unix timestamp in seconds)
 * @returns {StreamRecord} The updated stream record
 * @throws {Error} If stream not found or not in scheduled state
 */
export async function pauseStream(id: string): Promise<StreamRecord> {
  const stream = getStream(id);
  if (!stream) {
    const err: any = new Error("Stream not found.");
    err.statusCode = 404;
    throw err;
  }

  const status = computeStatus(stream, nowInSeconds());
  if (status !== "active") {
    const err: any = new Error("Only active streams can be paused.");
    err.statusCode = 400;
    throw err;
  }

  stream.pausedAt = nowInSeconds();
  const db = getDb();
  db.transaction(() => {
    upsertStream(stream);
    recordEventWithDb(db, stream.id, "paused", stream.pausedAt!, stream.sender);
  })();

  // Invalidate cache
  await invalidateCache(`stream:${id}`);
  await invalidateCache("streams:list:");
  await invalidateCache("streams:export:");
  resetStatsCache();
  resetStreamMetricsCache();

  triggerWebhook("paused", stream);
  return stream;
}

export async function resumeStream(id: string): Promise<StreamRecord> {
  const stream = getStream(id);
  if (!stream) {
    const err: any = new Error("Stream not found.");
    err.statusCode = 404;
    throw err;
  }

  if (stream.pausedAt === undefined) {
    const err: any = new Error("Stream is not paused.");
    err.statusCode = 400;
    throw err;
  }

  const now = nowInSeconds();
  const elapsed = now - stream.pausedAt;
  stream.pausedDuration = (stream.pausedDuration ?? 0) + elapsed;
  // Extend the effective duration so the recipient doesn't lose vesting time.  
  stream.durationSeconds += elapsed;
  stream.pausedAt = undefined;

  const db = getDb();
  db.transaction(() => {
    upsertStream(stream);
    recordEventWithDb(db, stream.id, "resumed", now, stream.sender, undefined, {
      pausedDuration: stream.pausedDuration,
    });
  })();

  // Invalidate cache
  await invalidateCache(`stream:${id}`);
  await invalidateCache("streams:list:");
  await invalidateCache("streams:export:");
  resetStatsCache();
  resetStreamMetricsCache();

  triggerWebhook("resumed", stream);
  return stream;
}

export async function updateStreamStartAt(id: string,
  newStartAt: number,
): Promise<StreamRecord> {
  const stream = getStream(id);
  if (!stream) {
    const err: any = new Error("Stream not found.");
    err.statusCode = 404;
    throw err;
  }

  const status = computeStatus(stream, nowInSeconds());
  if (status !== "scheduled") {
    const err: any = new Error(
      "Can only update start time for scheduled streams.",
    );
    err.statusCode = 400;
    throw err;
  }

  // Capture oldStartAt before mutating the record.
  const oldStartAt = stream.startAt;
  stream.startAt = newStartAt;
  const updatedAt = nowInSeconds();

  // Atomically write the updated stream row and the start-time event.
  const db = getDb();
  db.transaction(() => {
    upsertStream(stream);
    recordEventWithDb(
      db,
      stream.id,
      "start_time_updated",
      updatedAt,
      stream.sender,
      undefined,
      { oldStartAt, newStartAt },
    );
  })();

  // Invalidate cache
  await invalidateCache(`stream:${id}`);
  await invalidateCache("streams:list:");
  await invalidateCache("streams:export:");
  resetStatsCache();
  resetStreamMetricsCache();

  return stream;
}


/**
 * Soft-deletes a stream by setting archived_at timestamp.
 * This preserves the stream record for audit purposes.
 * @param {string} id - Stream ID to soft-delete
 * @returns {boolean} True if stream was archived, false if not found or already archived
 * Manually marks a fully-vested stream as completed.
 * Only callable when vestedAmount >= totalAmount.
 * Throws 400 if already completed/canceled or not fully vested.
 */
export function markStreamComplete(id: string, at: number = nowInSeconds()): StreamRecord {
  const stream = getStream(id);
  if (!stream) {
    const err: any = new Error("Stream not found.");
    err.statusCode = 404;
    throw err;
  }

  const status = computeStatus(stream, at);
  if (status === "completed") {
    const err: any = new Error("Stream is already completed.");
    err.statusCode = 400;
    throw err;
  }
  if (status === "canceled") {
    const err: any = new Error("Stream is already canceled.");
    err.statusCode = 400;
    throw err;
  }

  const progress = calculateProgress(stream, at);
  if (progress.vestedAmount < stream.totalAmount) {
    const err: any = new Error("Stream is not fully vested.");
    err.statusCode = 400;
    throw err;
  }

  stream.completedAt = at;

  const db = getDb();
  db.transaction(() => {
    upsertStream(stream);
    recordEventWithDb(db, stream.id, "completed", at, stream.sender);
  })();

  triggerWebhook("completed", stream);

  return stream;
}

/**
 * Deletes a stream and all associated events from the database.
 * This is a hard delete and cannot be undone.
 * @param {string} id - Stream ID to delete
 * @returns {boolean} True if stream was deleted, false if not found
 */
export function deleteStreamById(id: string): boolean {
  const db = getDb();

  const stream = db
    .prepare("SELECT id, archived_at FROM streams WHERE id = ?")
    .get(id) as { id: string; archived_at: number | null } | undefined;

  if (!stream) return false;

  if (stream.archived_at !== null) return false;

  const now = nowInSeconds();
  db.prepare("UPDATE streams SET archived_at = ? WHERE id = ?").run(now, id);

  return true;
}
