import {
  Keypair,
  Networks,
  TransactionBuilder,
  WebAuth,
} from "@stellar/stellar-sdk";
import jwt from "jsonwebtoken";
import { Request, Response, NextFunction } from "express";

const JWT_SECRET = process.env.JWT_SECRET || "default_local_dev_secret_key";
const SERVER_SIGNING_KEY =
  process.env.SERVER_SIGNING_KEY || Keypair.random().secret(); // Generate random for dev if not set
const DOMAIN = process.env.DOMAIN || "localhost";
const NETWORK_PASSPHRASE = process.env.NETWORK_PASSPHRASE || Networks.TESTNET;

export interface AuthUser {
  accountId: string;
}

export function generateChallenge(accountId: string): string {
  const serverKeypair = Keypair.fromSecret(SERVER_SIGNING_KEY);

  const challenge = WebAuth.buildChallengeTx(
    serverKeypair,
    accountId,
    DOMAIN,
    300, // Valid for 5 minutes
    NETWORK_PASSPHRASE,
    DOMAIN,
  );

  return challenge;
}

export function verifyChallengeAndIssueToken(
  transactionBase64: string,
): string {
  const serverKeypair = Keypair.fromSecret(SERVER_SIGNING_KEY);

  try {
    const { clientAccountID } = WebAuth.readChallengeTx(
      transactionBase64,
      serverKeypair.publicKey(),
      NETWORK_PASSPHRASE,
      DOMAIN,
      DOMAIN,
    );

    const signersFound = WebAuth.verifyChallengeTxSigners(
      transactionBase64,
      serverKeypair.publicKey(),
      NETWORK_PASSPHRASE,
      [clientAccountID],
      DOMAIN,
      DOMAIN,
    );

    if (!signersFound.includes(clientAccountID)) {
      throw new Error(
        "Challenge transaction verification failed (invalid signature).",
      );
    }

    const token = jwt.sign({ accountId: clientAccountID }, JWT_SECRET, {
      expiresIn: "24h",
    });
    return token;
  } catch (error: any) {
    throw new Error(`Challenge verification failed: ${error.message}`);
  }
}

export function authMiddleware(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    res.status(401).json({
      error: "Missing or invalid authorization header.",
      code: "UNAUTHORIZED",
    });
    return;
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, JWT_SECRET) as AuthUser;
    (req as any).user = decoded; // Attach user to request
    next();
  } catch (error) {
    res.status(401).json({
      error: "Invalid or expired authorization token.",
      code: "UNAUTHORIZED",
    });
  }
}
