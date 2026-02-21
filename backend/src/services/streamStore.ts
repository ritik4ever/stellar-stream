import { Keypair, rpc, Contract, nativeToScVal, scValToNative, Address, TimeoutInfinite, TransactionBuilder, Networks } from "@stellar/stellar-sdk";

export type StreamStatus = "scheduled" | "active" | "completed" | "canceled";

export interface StreamInput {
  sender: string;
  recipient: string;
  assetCode: string;
  totalAmount: number;
  durationSeconds: number;
  startAt?: number;
}

export interface StreamRecord {
  id: string; // The on-chain stream_id as string
  sender: string;
  recipient: string;
  assetCode: string; // Stored natively on-chain token Address instead, but for MVP keep it simple
  totalAmount: number;
  durationSeconds: number;
  startAt: number;
  createdAt: number;
  canceledAt?: number;
  completedAt?: number;
}

export interface StreamProgress {
  status: StreamStatus;
  ratePerSecond: number;
  elapsedSeconds: number;
  vestedAmount: number;
  remainingAmount: number;
  percentComplete: number;
}

const streams = new Map<string, StreamRecord>();

let rpcServer: rpc.Server | null = null;
let serverKeypair: Keypair | null = null;

export async function initSoroban() {
  const rpcUrl = process.env.RPC_URL || "https://soroban-testnet.stellar.org:443";
  rpcServer = new rpc.Server(rpcUrl);

  if (process.env.SERVER_PRIVATE_KEY) {
    serverKeypair = Keypair.fromSecret(process.env.SERVER_PRIVATE_KEY);
  } else {
    console.warn("SERVER_PRIVATE_KEY missing. Creating streams on-chain will fail.");
  }
}

function nowInSeconds(): number {
  return Math.floor(Date.now() / 1000);
}

function round(value: number): number {
  return Number(value.toFixed(6));
}

function computeStatus(stream: StreamRecord, at: number): StreamStatus {
  if (stream.canceledAt !== undefined) {
    return "canceled";
  }
  if (stream.completedAt !== undefined) {
    return "completed";
  }
  if (at < stream.startAt) {
    return "scheduled";
  }
  if (at >= stream.startAt + stream.durationSeconds) {
    return "completed";
  }
  return "active";
}

export function calculateProgress(stream: StreamRecord, at = nowInSeconds()): StreamProgress {
  const streamEnd = stream.startAt + stream.durationSeconds;
  const effectiveEnd = stream.canceledAt !== undefined ? Math.min(stream.canceledAt, streamEnd) : streamEnd;
  const elapsed = Math.max(0, Math.min(at, effectiveEnd) - stream.startAt);
  const ratio = Math.min(1, elapsed / stream.durationSeconds);
  const vestedAmount = stream.totalAmount * ratio;

  return {
    status: computeStatus(stream, at),
    ratePerSecond: round(stream.totalAmount / stream.durationSeconds),
    elapsedSeconds: elapsed,
    vestedAmount: round(vestedAmount),
    remainingAmount: round(Math.max(0, stream.totalAmount - vestedAmount)),
    percentComplete: round(ratio * 100),
  };
}

export async function syncStreams() {
  const contractId = process.env.CONTRACT_ID;
  if (!contractId || !rpcServer) return;
  const contract = new Contract(contractId);

  try {
    const pubKey = serverKeypair ? serverKeypair.publicKey() : "GAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAWHF";
    const sourceAccount = await rpcServer.getAccount(pubKey);
    const tx = new TransactionBuilder(sourceAccount, { fee: "100", networkPassphrase: process.env.NETWORK_PASSPHRASE || Networks.TESTNET })
      .addOperation(contract.call("get_next_stream_id"))
      .setTimeout(30)
      .build();

    const simRes = await rpcServer.simulateTransaction(tx);
    if (!rpc.Api.isSimulationSuccess(simRes) || !simRes.result) {
      console.warn("Failed to simulate get_next_stream_id", simRes);
      return;
    }

    const nextIdVal = scValToNative(simRes.result.retval);
    const nextId = Number(nextIdVal);

    for (let i = 1; i <= nextId; i++) {
      const simTx = new TransactionBuilder(sourceAccount, { fee: "100", networkPassphrase: process.env.NETWORK_PASSPHRASE || Networks.TESTNET })
        .addOperation(contract.call("get_stream", nativeToScVal(i, { type: "u64" })))
        .setTimeout(30)
        .build();
      const simRes2 = await rpcServer.simulateTransaction(simTx);
      if (rpc.Api.isSimulationSuccess(simRes2) && simRes2.result) {
        const streamData = scValToNative(simRes2.result.retval);

        streams.set(i.toString(), {
          id: i.toString(),
          sender: streamData.sender,
          recipient: streamData.recipient,
          assetCode: streamData.token,
          totalAmount: Number(streamData.total_amount),
          durationSeconds: Number(streamData.end_time) - Number(streamData.start_time),
          startAt: Number(streamData.start_time),
          createdAt: Number(streamData.start_time),
          canceledAt: streamData.canceled ? nowInSeconds() : undefined,
        });
      }
    }
  } catch (err) {
    console.error("Failed to sync streams", err);
  }
}

export async function createStream(input: StreamInput): Promise<StreamRecord> {
  const startAt = input.startAt ?? nowInSeconds();
  const contractId = process.env.CONTRACT_ID;
  const netPass = process.env.NETWORK_PASSPHRASE || "Test SDF Network ; September 2015";

  if (!contractId || !rpcServer || !serverKeypair) {
    throw new Error("Backend not configured for Soroban.");
  }

  const contract = new Contract(contractId);
  const endAt = startAt + input.durationSeconds;

  // Let's create an arbitrary testnet asset code for the token
  const fakeToken = contractId;

  const sourceAccount = await rpcServer.getAccount(serverKeypair.publicKey());

  const tx = new Contract(contractId).call("create_stream",
    new Address(input.sender).toScVal(),
    new Address(input.recipient).toScVal(),
    new Address(fakeToken).toScVal(),
    nativeToScVal(input.totalAmount, { type: "i128" }),
    nativeToScVal(startAt, { type: "u64" }),
    nativeToScVal(endAt, { type: "u64" })
  );

  // We have to build and send this tx. Wait, doing this properly via building is long:
  const built = await rpcServer.prepareTransaction(
    new TransactionBuilder(sourceAccount, { fee: "1000", networkPassphrase: netPass })
      .addOperation(tx)
      .setTimeout(30)
      .build()
  );

  built.sign(serverKeypair);

  const sendRes = await rpcServer.sendTransaction(built);
  if (sendRes.status !== "PENDING") {
    throw new Error("Failed to send transaction: " + JSON.stringify(sendRes));
  }

  let txResult;
  let attempts = 0;
  while (attempts < 10) {
    txResult = await rpcServer.getTransaction(sendRes.hash);
    if (txResult.status !== "NOT_FOUND") break;
    await new Promise(r => setTimeout(r, 1000));
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
  };

  streams.set(stream.id, stream);
  return stream;
}

export function refreshStreamStatuses(): number {
  const now = nowInSeconds();
  let updated = 0;
  for (const stream of streams.values()) {
    if (stream.canceledAt !== undefined || stream.completedAt !== undefined) continue;
    if (now >= stream.startAt + stream.durationSeconds) {
      stream.completedAt = now;
      streams.set(stream.id, stream);
      updated += 1;
    }
  }
  return updated;
}

export function listStreams(): StreamRecord[] {
  return Array.from(streams.values()).sort((a, b) => b.createdAt - a.createdAt);
}

export function getStream(id: string): StreamRecord | undefined {
  return streams.get(id);
}

export async function cancelStream(id: string): Promise<StreamRecord | undefined> {
  const stream = streams.get(id);
  if (!stream || stream.canceledAt !== undefined) {
    return stream;
  }

  // Here we would call the contract cancel. For MVP we will just do local DB update
  stream.canceledAt = nowInSeconds();
  streams.set(id, stream);
  return stream;
