/**
 * Soroban / on-chain interactions for the StellarStream frontend.
 *
 * For detailed TypeScript usage examples of the generated contract client,
 * see: docs/CONTRACT_BINDINGS.md
 *
 * `claimStream` builds a Soroban `claim` transaction in the browser, asks
 * Freighter to sign as the recipient, and submits the signed transaction to
 * Stellar RPC.
 *
 * To use the generated contract client directly (for read operations or
 * wallet-signed transactions), import from `./contractClient`.
 */

import * as freighter from "@stellar/freighter-api";
import {
  Address,
  Contract,
  TransactionBuilder,
  nativeToScVal,
  rpc,
} from "@stellar/stellar-sdk";
import { getAuthToken } from "./api";
import type { StreamEvent } from "./api";
import { CONTRACT_ID, RPC_URL, NETWORK_PASSPHRASE } from "./contractClient";

const API_BASE = (import.meta as any).env?.VITE_API_URL ?? "/api";

export interface ClaimResult {
  /** Amount of tokens transferred to the recipient in this claim. */
  claimedAmount: number;
  /** Asset code of the claimed tokens. */
  assetCode: string;
  /** Stellar transaction hash confirming the on-chain claim. */
  txHash: string;
}

export interface ClaimResponse {
  result: ClaimResult;
  history: StreamEvent[];
}

export class SorobanClaimError extends Error {
  code: string;
  constructor(message: string, code: string) {
    super(message);
    this.name = "SorobanClaimError";
    this.code = code;
  }
}

const DEFAULT_FEE_STROOPS = "100";
const TX_POLL_INTERVAL_MS = 1_000;
const TX_POLL_ATTEMPTS = 30;

type FreighterSignedTransaction =
  | string
  | {
      signedTxXdr?: string;
      signedTransaction?: string;
      transactionXdr?: string;
    };

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeSignedXdr(signed: FreighterSignedTransaction): string {
  if (typeof signed === "string") return signed;

  const xdr =
    signed.signedTxXdr ?? signed.signedTransaction ?? signed.transactionXdr;
  if (!xdr) {
    throw new SorobanClaimError(
      "Freighter did not return a signed transaction.",
      "FREIGHTER_SIGNING_FAILED",
    );
  }
  return xdr;
}

function toContractI128Amount(amount: number): bigint {
  if (!Number.isFinite(amount) || amount <= 0) {
    throw new SorobanClaimError(
      "No claimable amount available.",
      "NO_CLAIMABLE_AMOUNT",
    );
  }

  if (!Number.isInteger(amount)) {
    throw new SorobanClaimError(
      "Claim amount must be an integer contract amount.",
      "INVALID_CLAIM_AMOUNT",
    );
  }

  return BigInt(amount);
}

function getRpcServer(): rpc.Server {
  return new rpc.Server(RPC_URL, {
    allowHttp: RPC_URL.startsWith("http://"),
  });
}

async function waitForFinalTransactionStatus(
  server: rpc.Server,
  txHash: string,
): Promise<void> {
  for (let attempt = 0; attempt < TX_POLL_ATTEMPTS; attempt++) {
    let status: string;
    try {
      const tx = await server.getTransaction(txHash);
      status = String((tx as { status?: unknown }).status ?? "");
    } catch {
      status = "NOT_FOUND";
    }

    if (status === "SUCCESS") return;

    if (status === "FAILED") {
      throw new SorobanClaimError(
        "Soroban claim transaction failed.",
        "TRANSACTION_FAILED",
      );
    }

    await sleep(TX_POLL_INTERVAL_MS);
  }
}

/**
 * Claim vested tokens from a stream.
 *
 * @param streamId       - Numeric stream ID.
 * @param recipientAddress - Stellar public key of the recipient (must match stream).
 * @param amount         - Claimable amount as reported by the backend (for display only;
 *                         the contract determines the actual claimable amount on-chain).
 * @param assetCode      - Asset code used in the UI result.
 */
export async function claimWithFreighter(
  streamId: string,
  recipientAddress: string,
  amount: number,
  assetCode = "tokens",
): Promise<ClaimResponse> {
  if (!CONTRACT_ID) {
    throw new SorobanClaimError(
      "Missing VITE_CONTRACT_ID; cannot submit Soroban claim.",
      "MISSING_CONTRACT_ID",
    );
  }

  const streamIdNumber = Number(streamId);
  if (!Number.isSafeInteger(streamIdNumber) || streamIdNumber <= 0) {
    throw new SorobanClaimError("Invalid stream ID.", "INVALID_STREAM_ID");
  }

  const contractAmount = toContractI128Amount(amount);
  const server = getRpcServer();
  const sourceAccount = await server.getAccount(recipientAddress);
  const contract = new Contract(CONTRACT_ID);

  const transaction = new TransactionBuilder(sourceAccount, {
    fee: DEFAULT_FEE_STROOPS,
    networkPassphrase: NETWORK_PASSPHRASE,
  })
    .addOperation(
      contract.call(
        "claim",
        nativeToScVal(streamIdNumber, { type: "u64" }),
        new Address(recipientAddress).toScVal(),
        nativeToScVal(contractAmount, { type: "i128" }),
      ),
    )
    .setTimeout(30)
    .build();

  const preparedTransaction = await server.prepareTransaction(transaction);
  const signed = await (freighter as any).signTransaction(
    preparedTransaction.toXDR(),
    {
      accountToSign: recipientAddress,
      networkPassphrase: NETWORK_PASSPHRASE,
    },
  );
  const signedTransaction = TransactionBuilder.fromXDR(
    normalizeSignedXdr(signed),
    NETWORK_PASSPHRASE,
  );

  const sendResponse = await server.sendTransaction(signedTransaction);
  const txHash = (sendResponse as { hash?: string }).hash;
  if (!txHash) {
    throw new SorobanClaimError(
      "Soroban RPC did not return a transaction hash.",
      "MISSING_TRANSACTION_HASH",
    );
  }

  const sendStatus = String((sendResponse as { status?: unknown }).status ?? "");
  if (sendStatus && sendStatus !== "PENDING") {
    throw new SorobanClaimError(
      `Soroban claim submission failed: ${sendStatus}`,
      "TRANSACTION_SUBMISSION_FAILED",
    );
  }

  await waitForFinalTransactionStatus(server, txHash);

  return {
    result: {
      claimedAmount: amount,
      assetCode,
      txHash,
    },
    history: [],
  };
}

export const claimOnChain = claimWithFreighter;
export const claimStream = claimWithFreighter;

export interface ClaimableBatchResponse {
  amounts: Record<string, number>;
  at: number;
}

/**
 * Simulate on-chain claimable amounts for multiple streams via get_claimable_batch.
 * Maximum 20 stream IDs per request (Soroban contract limit).
 */
export async function getClaimableBatch(
  streamIds: string[],
): Promise<ClaimableBatchResponse> {
  const token = getAuthToken();

  const response = await fetch(`${API_BASE}/streams/claimable/batch`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: JSON.stringify({ streamIds }),
  });

  if (!response.ok) {
    let message = `Failed to fetch claimable batch (${response.status})`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body.error) message = body.error;
    } catch {
      // ignore JSON parse errors
    }
    throw new Error(message);
  }

  return response.json() as Promise<ClaimableBatchResponse>;
}
