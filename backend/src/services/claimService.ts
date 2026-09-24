import {
  Address,
  Contract,
  Keypair,
  Networks,
  TransactionBuilder,
  nativeToScVal,
  rpc,
  scValToNative,
} from '@stellar/stellar-sdk';
import { retryWithBackoff } from '../utils/sorobanRetry';

export interface ClaimSubmissionResult {
  txHash: string;
  amountClaimed: number;
  ledgerSequence?: number;
}

type ClaimServiceError = Error & {
  statusCode?: number;
  code?: string;
};

function serviceError(
  message: string,
  statusCode: number,
  code: string,
): ClaimServiceError {
  const error = new Error(message) as ClaimServiceError;
  error.statusCode = statusCode;
  error.code = code;
  return error;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Build, sign and submit a Soroban `claim` transaction.
 *
 * The StellarStream contract requires authorization from the stream recipient.
 * Because issue #710 explicitly requires the backend to sign the transaction,
 * the configured backend signing key must correspond to that recipient.
 */
export async function submitClaimTransaction(
  streamId: string,
  recipient: string,
  amount: number,
): Promise<ClaimSubmissionResult> {
  const numericStreamId = Number(streamId);

  if (!Number.isSafeInteger(numericStreamId) || numericStreamId <= 0) {
    throw serviceError(
      'Invalid stream ID for claim transaction.',
      400,
      'INVALID_STREAM_ID',
    );
  }

  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw serviceError(
      'Claim amount must be a positive integer.',
      400,
      'INVALID_CLAIM_AMOUNT',
    );
  }

  const contractId = process.env.CONTRACT_ID?.trim();

  if (!contractId) {
    throw serviceError(
      'CONTRACT_ID is required to submit a claim transaction.',
      500,
      'SOROBAN_NOT_CONFIGURED',
    );
  }

  const secretKey =
    process.env.STELLAR_SECRET_KEY?.trim() ||
    process.env.SERVER_PRIVATE_KEY?.trim();

  if (!secretKey) {
    throw serviceError(
      'STELLAR_SECRET_KEY or SERVER_PRIVATE_KEY is required to sign a claim transaction.',
      500,
      'SOROBAN_NOT_CONFIGURED',
    );
  }

  let signer: Keypair;

  try {
    signer = Keypair.fromSecret(secretKey);
  } catch {
    throw serviceError(
      'The configured Stellar signing key is invalid.',
      500,
      'INVALID_SIGNING_KEY',
    );
  }

  /*
   * claim() calls recipient.require_auth() on-chain. A backend-signed
   * transaction can therefore satisfy the authorization only when the
   * configured signer represents the recipient.
   */
  if (signer.publicKey() !== recipient) {
    throw serviceError(
      'The configured backend signing key does not match the stream recipient.',
      500,
      'CLAIM_SIGNER_MISMATCH',
    );
  }

  const rpcUrl =
    process.env.RPC_URL?.trim() || 'https://soroban-testnet.stellar.org:443';

  const networkPassphrase = process.env.NETWORK_PASSPHRASE || Networks.TESTNET;

  const server = new rpc.Server(rpcUrl);

  const sourceAccount = await retryWithBackoff(() =>
    server.getAccount(signer.publicKey()),
  );

  const contract = new Contract(contractId);

  const claimOperation = contract.call(
    'claim',
    nativeToScVal(numericStreamId, { type: 'u64' }),
    new Address(recipient).toScVal(),
    nativeToScVal(amount, { type: 'i128' }),
  );

  const transaction = new TransactionBuilder(sourceAccount, {
    fee: '1000',
    networkPassphrase,
  })
    .addOperation(claimOperation)
    .setTimeout(30)
    .build();

  /*
   * prepareTransaction simulates the invocation and applies the Soroban
   * transaction data required for submission.
   */
  const preparedTransaction = await retryWithBackoff(() =>
    server.prepareTransaction(transaction),
  );

  preparedTransaction.sign(signer);

  const sendResult = await retryWithBackoff(() =>
    server.sendTransaction(preparedTransaction),
  );

  if (sendResult.status !== 'PENDING' && sendResult.status !== 'DUPLICATE') {
    throw serviceError(
      `Soroban claim transaction was rejected: ${JSON.stringify(sendResult)}`,
      502,
      'CLAIM_SUBMISSION_FAILED',
    );
  }

  const txHash = sendResult.hash;

  if (!txHash) {
    throw serviceError(
      'Soroban RPC did not return a transaction hash for the claim.',
      502,
      'CLAIM_SUBMISSION_FAILED',
    );
  }

  for (let attempt = 0; attempt < 15; attempt += 1) {
    const txResult = await retryWithBackoff(() =>
      server.getTransaction(txHash),
    );

    if (txResult.status === 'SUCCESS') {
      const amountClaimed =
        txResult.returnValue !== undefined
          ? Number(scValToNative(txResult.returnValue))
          : amount;

      if (!Number.isFinite(amountClaimed) || amountClaimed <= 0) {
        throw serviceError(
          'The successful claim transaction returned an invalid claimed amount.',
          502,
          'INVALID_CLAIM_RESULT',
        );
      }

      const ledgerSequence =
        typeof (txResult as { ledger?: unknown }).ledger === 'number'
          ? (txResult as { ledger: number }).ledger
          : undefined;

      return {
        txHash,
        amountClaimed,
        ledgerSequence,
      };
    }

    if (txResult.status === 'FAILED') {
      throw serviceError(
        `Soroban claim transaction failed: ${JSON.stringify(txResult)}`,
        502,
        'CLAIM_TRANSACTION_FAILED',
      );
    }

    await sleep(1000);
  }

  throw serviceError(
    'Timed out waiting for the Soroban claim transaction to complete.',
    504,
    'CLAIM_TRANSACTION_TIMEOUT',
  );
}
