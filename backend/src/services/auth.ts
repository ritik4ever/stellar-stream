import {
  Account,
  Keypair,
  Networks,
  Operation,
  TransactionBuilder,
  WebAuth,
} from "@stellar/stellar-sdk";
import jwt from "jsonwebtoken";
import crypto from "crypto";
import { Request, Response, NextFunction } from "express";
import { sendApiError } from "../apiErrors";
import { logger } from "../logger";

const HORIZON_URL = (process.env.HORIZON_URL || "https://horizon-testnet.stellar.org").trim();

const SERVER_SIGNING_KEY =
  process.env.SERVER_SIGNING_KEY || (process.env.NODE_ENV === 'production' 
    ? ((): string => { throw new Error("SERVER_SIGNING_KEY must be set in production") })() 
    : Keypair.random().secret());

const DOMAIN = (process.env.DOMAIN || "localhost").trim();
const NETWORK_PASSPHRASE = process.env.NETWORK_PASSPHRASE || Networks.TESTNET;

// Replay attack prevention
const TIMESTAMP_TOLERANCE_SECONDS = 60; // 60 seconds tolerance
const nonceStore = new Map<string, number>(); // nonce -> expiry timestamp

// Clean up expired nonces every 5 minutes
setInterval(() => {
  const now = Math.floor(Date.now() / 1000);
  for (const [nonce, expiry] of nonceStore.entries()) {
    if (now > expiry) {
      nonceStore.delete(nonce);
    }
  }
}, 5 * 60 * 1000);

let jwtSecret = process.env.JWT_SECRET;

if (!jwtSecret) {
  if (process.env.NODE_ENV === "production") {
    throw new Error("JWT_SECRET must be set in production");
  }

  jwtSecret = crypto.randomBytes(32).toString("hex");

  logger.warn(
    "JWT_SECRET not set — using ephemeral secret. All tokens will be invalidated on restart.",
  );
} else {
  logger.warn(
    "JWT_SECRET is configured. Rotating this secret will invalidate all existing tokens and force all users to re-authenticate.",
  );
}

export function getJwtSecret() {
  return jwtSecret as string;
}

export interface AuthUser {
  accountId: string;
  signer_count?: number;
  threshold?: number;
}

interface HorizonSigner {
  key: string;
  weight: number;
  type: string;
}

interface HorizonAccountThresholds {
  low_threshold: number;
  med_threshold: number;
  high_threshold: number;
}

interface HorizonAccountResponse {
  signers: HorizonSigner[];
  thresholds: HorizonAccountThresholds;
}

/**
 * Fetches account signers and thresholds from Horizon.
 * Returns null if the account doesn't exist (unfunded) or on network error.
 */
async function fetchAccountSigners(
  accountId: string,
): Promise<{ signers: string[]; threshold: number } | null> {
  try {
    const response = await fetch(`${HORIZON_URL}/accounts/${accountId}`);
    if (!response.ok) return null;

    const data = (await response.json()) as HorizonAccountResponse;
    const signers = data.signers
      .filter((s) => s.weight > 0)
      .map((s) => s.key);
    // Use the medium threshold (required for most operations)
    const threshold = data.thresholds.med_threshold;
    return { signers, threshold };
  } catch {
    return null;
  }
}

export function generateChallenge(accountId: string): string {
  const serverKeypair = Keypair.fromSecret(SERVER_SIGNING_KEY);
  
  // Generate a unique nonce for this challenge
  const nonce = crypto.randomBytes(16).toString('hex'); // Shorter nonce for manage data
  const timestamp = Math.floor(Date.now() / 1000);
  
  // Create challenge transaction with timestamp and nonce in manage data operation
  const transaction = new TransactionBuilder(
    new Account(serverKeypair.publicKey(), "-1"),
    {
      fee: "100",
      networkPassphrase: NETWORK_PASSPHRASE,
      timebounds: {
        minTime: 0,
        maxTime: Math.floor(Date.now() / 1000) + 300, // 5 minutes
      },
    }
  )
    .addOperation(
      Operation.manageData({
        name: `${DOMAIN} auth`,
        // SEP-10: value must be a 64-char base64 random string (48 random bytes)
        value: crypto.randomBytes(48).toString("base64"),
        source: accountId, // SEP-10: first op must have the client account as source
      })
    )
    .addOperation(
      Operation.manageData({
        name: "web_auth_domain",
        value: DOMAIN,
        source: serverKeypair.publicKey(),
      })
    )
    .addOperation(
      Operation.manageData({
        name: "timestamp",
        value: timestamp.toString(),
        source: serverKeypair.publicKey(),
      })
    )
    .addOperation(
      Operation.manageData({
        name: "nonce",
        value: nonce,
        source: serverKeypair.publicKey(),
      })
    )
    .build();

  transaction.sign(serverKeypair);
  return transaction.toEnvelope().toXDR("base64");
}

/**
 * Verifies a SEP-10 challenge transaction and issues a JWT.
 * Supports both standard single-signer accounts and M-of-N multisig accounts.
 * 
 * Includes replay attack prevention:
 * - Validates timestamp is within 60 seconds of current time
 * - Ensures nonce hasn't been used before
 * - Stores nonce for 60 seconds to prevent replay
 *
 * For multisig accounts, fetches signers from Horizon and passes them all to
 * verifyChallengeTxSigners. The JWT payload includes signer_count and threshold.
 *
 * Rejects if:
 * - Transaction is malformed or not a SEP-10 challenge
 * - Transaction has expired (stale)
 * - Domain/Network doesn't match
 * - Client signature(s) are missing or invalid
 * - Timestamp is too old or too far in the future
 * - Nonce has been used before (replay attack)
 */
export async function verifyChallengeAndIssueToken(
  transactionBase64: string,
): Promise<string> {
  const serverKeypair = Keypair.fromSecret(SERVER_SIGNING_KEY);
  const serverAccountId = serverKeypair.publicKey();

  try {
    // readChallengeTx validates the transaction structure and server signature
    const challengeTx = WebAuth.readChallengeTx(
      transactionBase64,
      serverAccountId,
      NETWORK_PASSPHRASE,
      DOMAIN,
      DOMAIN,
    );

    const { clientAccountID, tx } = challengeTx;
    const ops = tx.operations;

    const timestampOp = ops.find(op => op.type === 'manageData' && op.name === 'timestamp') as Operation.ManageData | undefined;
    const nonceOp = ops.find(op => op.type === 'manageData' && op.name === 'nonce') as Operation.ManageData | undefined;

    // Validate timestamp and nonce for replay attack prevention
    if (timestampOp?.value && nonceOp?.value) {
      const timestampStr = timestampOp.value.toString('utf-8');
      const nonce = nonceOp.value.toString('utf-8');
      
      if (!timestampStr || !nonce) {
        throw new Error("Invalid challenge format: missing timestamp or nonce");
      }

      const timestamp = parseInt(timestampStr, 10);
      const now = Math.floor(Date.now() / 1000);
      const timeDiff = Math.abs(now - timestamp);
      
      // Check if timestamp is within tolerance
      if (timeDiff > TIMESTAMP_TOLERANCE_SECONDS) {
        throw new Error(`Challenge timestamp is too old or too far in the future (${timeDiff}s difference)`);
      }

      // Check if nonce has been used before (replay attack)
      if (nonceStore.has(nonce)) {
        throw new Error("Challenge nonce has already been used (replay attack detected)");
      }

      // Store nonce with expiry time to prevent replay
      const expiryTime = now + TIMESTAMP_TOLERANCE_SECONDS;
      nonceStore.set(nonce, expiryTime);
    } else {
      throw new Error("Challenge missing required timestamp and nonce");
    }

    // Try to fetch account signers from Horizon to detect multisig accounts
    const accountInfo = await fetchAccountSigners(clientAccountID);
    const isMultisig =
      accountInfo !== null && accountInfo.signers.length > 1;

    let signersToVerify: string[];
    if (isMultisig) {
      signersToVerify = accountInfo.signers;
    } else {
      signersToVerify = [clientAccountID];
    }

    // verifyChallengeTxSigners ensures the required signers actually signed it
    const signersFound = WebAuth.verifyChallengeTxSigners(
      transactionBase64,
      serverAccountId,
      NETWORK_PASSPHRASE,
      signersToVerify,
      DOMAIN,
      DOMAIN,
    );

    if (!signersFound || signersFound.length === 0) {
      throw new Error(
        "Challenge transaction verification failed (invalid signature).",
      );
    }

    const payload: AuthUser = { accountId: clientAccountID };
    if (isMultisig && accountInfo) {
      payload.signer_count = accountInfo.signers.length;
      payload.threshold = accountInfo.threshold;
    }

    const token = jwt.sign(payload, getJwtSecret(), { expiresIn: "24h" });
    return token;
  } catch (error: any) {
    if (error.message?.includes("TimeBounds")) {
      const err = new Error("Challenge has expired. Please request a new one.");
      (err as any).statusCode = 401;
      (err as any).code = "UNAUTHORIZED";
      throw err;
    }
    const err = new Error(`Challenge verification failed: ${error.message}`);
    (err as any).statusCode = 401;
    (err as any).code = "UNAUTHORIZED";
    throw err;
  }
}

/**
 * Refreshes a still-valid JWT and returns a new one with a fresh 24h expiry.
 *
 * Accepts the current token in the Authorization header (Bearer scheme).
 * Returns 401 if the token is missing, malformed, or already expired.
 */
export function refreshToken(req: Request, res: Response): void {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    sendApiError(req, res, 401, "Missing or invalid authorization header.", {
      code: "UNAUTHORIZED",
    });
    return;
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, getJwtSecret()) as AuthUser;

    const newToken = jwt.sign(
      { accountId: decoded.accountId },
      getJwtSecret(),
      { expiresIn: "24h" },
    );

    res.json({ token: newToken });
  } catch {
    sendApiError(req, res, 401, "Invalid or expired authorization token.", {
      code: "UNAUTHORIZED",
    });
  }
}

export function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    sendApiError(req, res, 401, "Missing or invalid authorization header.", {
      code: "unauthorized",
    });
    return;
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, getJwtSecret()) as AuthUser;
    (req as any).user = decoded; // Attach user to request
    next();
  } catch (error: any) {
    if (error.name === "TokenExpiredError") {
      sendApiError(req, res, 401, "Authorization token has expired.", {
        code: "token_expired",
      });
    } else {
      sendApiError(req, res, 401, "Invalid authorization token.", {
        code: "invalid_token",
      });
    }
  }
}

export function adminJwtAuth(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    sendApiError(req, res, 401, "Missing or invalid authorization header.", {
      code: "unauthorized",
    });
    return;
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, getJwtSecret()) as any;
    if (decoded.role !== "admin" && decoded.accountId !== "admin" && !decoded.isAdmin) {
      sendApiError(req, res, 403, "Forbidden: Admin access required.", {
        code: "forbidden",
      });
      return;
    }
    (req as any).user = decoded; // Attach user to request
    next();
  } catch (error: any) {
    if (error.name === "TokenExpiredError") {
      sendApiError(req, res, 401, "Authorization token has expired.", {
        code: "token_expired",
      });
    } else {
      sendApiError(req, res, 401, "Invalid authorization token.", {
        code: "invalid_token",
      });
    }
  }
}
