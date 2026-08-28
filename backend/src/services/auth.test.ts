import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { Keypair, Networks, WebAuth, Transaction, Operation, Account, TransactionBuilder } from "@stellar/stellar-sdk";
import jwt from "jsonwebtoken";
import crypto from "crypto";

const TEST_JWT_SECRET = "test_jwt_secret_multisig";

// Must stub env before importing the module under test
vi.stubEnv("JWT_SECRET", TEST_JWT_SECRET);
vi.stubEnv("NETWORK_PASSPHRASE", Networks.TESTNET);
vi.stubEnv("DOMAIN", "localhost");

const serverKeypair = Keypair.random();
vi.stubEnv("SERVER_SIGNING_KEY", serverKeypair.secret());

// Import after env stubs are in place
// @ts-expect-error: Top-level await is supported by Vitest
const { verifyChallengeAndIssueToken, authMiddleware, generateChallenge } = await import("./auth");

function signChallenge(challengeXdr: string, ...signers: Keypair[]): string {
  // The challenge from generateChallenge is already signed by the server.
  // We just need to add client signatures.
  const tx = new Transaction(challengeXdr, Networks.TESTNET);
  tx.sign(...signers);
  return tx.toEnvelope().toXDR("base64");
}

function modifyChallengeOps(challengeXdr: string, modifications: { timestamp?: number, nonce?: string, removeNonce?: boolean, removeTimestamp?: boolean }): string {
  const originalTx = new Transaction(challengeXdr, Networks.TESTNET);
  const serverAccount = new Account(serverKeypair.publicKey(), "-1");

  const builder = new TransactionBuilder(serverAccount, {
      fee: originalTx.fee,
      networkPassphrase: originalTx.networkPassphrase,
      timebounds: originalTx.timeBounds,
  });

  for (const op of originalTx.operations) {
      if (op.type === 'manageData') {
          if (op.name === 'timestamp') {
              if (modifications.removeTimestamp) continue;
              if (modifications.timestamp !== undefined) {
                  builder.addOperation(Operation.manageData({ name: 'timestamp', value: modifications.timestamp.toString(), source: op.source }));
                  continue;
              }
          }
          if (op.name === 'nonce') {
              if (modifications.removeNonce) continue;
              if (modifications.nonce !== undefined) {
                  builder.addOperation(Operation.manageData({ name: 'nonce', value: modifications.nonce, source: op.source }));
                  continue;
              }
          }
          builder.addOperation(Operation.manageData({ name: op.name, value: op.value as any, source: op.source }));
      } else {
          builder.addOperation(op as any);
      }
  }
  
  const newTx = builder.build();
  newTx.sign(serverKeypair); // re-sign with server key
  return newTx.toEnvelope().toXDR("base64");
}

describe("verifyChallengeAndIssueToken", () => {
  const clientKeypair = Keypair.random();

  beforeEach(() => {
    vi.restoreAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe("single-signer (standard account)", () => {
    it("issues a JWT without signer_count/threshold when Horizon returns null", async () => {
      // Horizon fetch fails → falls back to single-signer
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));

      const challenge = generateChallenge(clientKeypair.publicKey());
      const signedTx = signChallenge(challenge, clientKeypair);
      const token = await verifyChallengeAndIssueToken(signedTx);

      const decoded = jwt.verify(token, TEST_JWT_SECRET) as any;
      expect(decoded.accountId).toBe(clientKeypair.publicKey());
      expect(decoded.signer_count).toBeUndefined();
      expect(decoded.threshold).toBeUndefined();
    });

    it("issues a JWT without multisig fields when account has only one signer", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            signers: [{ key: clientKeypair.publicKey(), weight: 1, type: "ed25519_public_key" }],
            thresholds: { low_threshold: 0, med_threshold: 0, high_threshold: 0 },
          }),
        }),
      );

      const challenge = generateChallenge(clientKeypair.publicKey());
      const signedTx = signChallenge(challenge, clientKeypair);
      const token = await verifyChallengeAndIssueToken(signedTx);

      const decoded = jwt.verify(token, TEST_JWT_SECRET) as any;
      expect(decoded.accountId).toBe(clientKeypair.publicKey());
      expect(decoded.signer_count).toBeUndefined();
      expect(decoded.threshold).toBeUndefined();
    });
  });

  describe("multi-signer (multisig account)", () => {
    const cosigner1 = Keypair.random();
    const cosigner2 = Keypair.random();

    it("issues a JWT with signer_count and threshold for a 2-of-3 multisig account", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            signers: [
              { key: clientKeypair.publicKey(), weight: 1, type: "ed25519_public_key" },
              { key: cosigner1.publicKey(), weight: 1, type: "ed25519_public_key" },
              { key: cosigner2.publicKey(), weight: 1, type: "ed25519_public_key" },
            ],
            thresholds: { low_threshold: 1, med_threshold: 2, high_threshold: 3 },
          }),
        }),
      );

      const challenge = generateChallenge(clientKeypair.publicKey());
      const signedTx = signChallenge(challenge, clientKeypair, cosigner1, cosigner2);

      const token = await verifyChallengeAndIssueToken(signedTx);
      const decoded = jwt.verify(token, TEST_JWT_SECRET) as any;

      expect(decoded.accountId).toBe(clientKeypair.publicKey());
      expect(decoded.signer_count).toBe(3);
      expect(decoded.threshold).toBe(2); // med_threshold
    });

    it("excludes zero-weight signers from signer_count", async () => {
      vi.stubGlobal(
        "fetch",
        vi.fn().mockResolvedValue({
          ok: true,
          json: async () => ({
            signers: [
              { key: clientKeypair.publicKey(), weight: 1, type: "ed25519_public_key" },
              { key: cosigner1.publicKey(), weight: 1, type: "ed25519_public_key" },
              // weight 0 = revoked signer, should be excluded
              { key: cosigner2.publicKey(), weight: 0, type: "ed25519_public_key" },
            ],
            thresholds: { low_threshold: 1, med_threshold: 1, high_threshold: 2 },
          }),
        }),
      );

      const challenge = generateChallenge(clientKeypair.publicKey());
      const signedTx = signChallenge(challenge, clientKeypair, cosigner1);

      const token = await verifyChallengeAndIssueToken(signedTx);
      const decoded = jwt.verify(token, TEST_JWT_SECRET) as any;

      // 2 active signers (weight > 0) → still multisig, zero-weight signer excluded
      expect(decoded.signer_count).toBe(2);
      expect(decoded.threshold).toBe(1);
    });
  });

  describe("error cases", () => {
    it("throws on a malformed transaction", async () => {
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
      await expect(verifyChallengeAndIssueToken("not-a-valid-tx")).rejects.toThrow(
        "Challenge verification failed",
      );
    });
  });

  describe("replay attack prevention", () => {
    beforeEach(() => {
      // Mock Horizon to return single-signer account
      vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
    });

    it("accepts fresh timestamp within tolerance", async () => {
      const challenge = generateChallenge(clientKeypair.publicKey());
      const signedTx = signChallenge(challenge, clientKeypair);
      
      const token = await verifyChallengeAndIssueToken(signedTx);
      const decoded = jwt.verify(token, TEST_JWT_SECRET) as any;
      expect(decoded.accountId).toBe(clientKeypair.publicKey());
    });

    it("rejects timestamp older than 60 seconds", async () => {
      const oldTimestamp = Math.floor(Date.now() / 1000) - 61; // 61 seconds ago
      let challenge = generateChallenge(clientKeypair.publicKey());
      challenge = modifyChallengeOps(challenge, { timestamp: oldTimestamp });
      const signedTx = signChallenge(challenge, clientKeypair);
      
      await expect(verifyChallengeAndIssueToken(signedTx)).rejects.toThrow(
        "Challenge timestamp is too old or too far in the future"
      );
    });

    it("rejects timestamp too far in the future", async () => {
      const futureTimestamp = Math.floor(Date.now() / 1000) + 61; // 61 seconds in future
      let challenge = generateChallenge(clientKeypair.publicKey());
      challenge = modifyChallengeOps(challenge, { timestamp: futureTimestamp });
      const signedTx = signChallenge(challenge, clientKeypair);
      
      await expect(verifyChallengeAndIssueToken(signedTx)).rejects.toThrow(
        "Challenge timestamp is too old or too far in the future"
      );
    });

    it("rejects replayed nonce", async () => {
      const nonce = "replay_nonce_123";
      let challenge1 = generateChallenge(clientKeypair.publicKey());
      challenge1 = modifyChallengeOps(challenge1, { nonce });
      const signedTx1 = signChallenge(challenge1, clientKeypair);
      
      const token1 = await verifyChallengeAndIssueToken(signedTx1);
      expect(token1).toBeDefined();
      
      let challenge2 = generateChallenge(clientKeypair.publicKey());
      challenge2 = modifyChallengeOps(challenge2, { nonce });
      const signedTx2 = signChallenge(challenge2, clientKeypair);
      await expect(verifyChallengeAndIssueToken(signedTx2)).rejects.toThrow(
        "Challenge nonce has already been used (replay attack detected)"
      );
    });

    it("rejects challenge without timestamp and nonce", async () => {
      let challenge = generateChallenge(clientKeypair.publicKey());
      challenge = modifyChallengeOps(challenge, { removeTimestamp: true, removeNonce: true });
      const signedTx = signChallenge(challenge, clientKeypair);
      
      await expect(verifyChallengeAndIssueToken(signedTx)).rejects.toThrow(
        "Challenge missing required timestamp and nonce"
      );
    });

    it("rejects challenge with missing nonce", async () => {
      let challenge = generateChallenge(clientKeypair.publicKey());
      challenge = modifyChallengeOps(challenge, { removeNonce: true });
      const signedTx = signChallenge(challenge, clientKeypair);
      
      await expect(verifyChallengeAndIssueToken(signedTx)).rejects.toThrow(
        "Challenge missing required timestamp and nonce"
      );
    });
  });

  describe("generateChallenge", () => {
    it("generates challenge with timestamp and nonce in manageData operations", () => {
      const accountId = clientKeypair.publicKey();
      const challenge = generateChallenge(accountId);
      
      const tx = new Transaction(challenge, Networks.TESTNET);
      
      const timestampOp = tx.operations.find(op => op.type === 'manageData' && op.name === 'timestamp') as Operation.ManageData;
      const nonceOp = tx.operations.find(op => op.type === 'manageData' && op.name === 'nonce') as Operation.ManageData;

      expect(timestampOp).toBeDefined();
      expect(nonceOp).toBeDefined();
      
      const timestamp = parseInt(timestampOp.value!.toString('utf-8'), 10);
      const nonce = nonceOp.value!.toString('utf-8');
      
      expect(nonce).toMatch(/^[a-f0-9]{32}$/);
      
      const now = Math.floor(Date.now() / 1000);
      expect(Math.abs(now - timestamp)).toBeLessThan(5); // Should be very recent
    });
  });
});

describe("authMiddleware", () => {
  let req: any;
  let res: any;
  let next: any;

  beforeEach(() => {
    req = {
      headers: {},
      requestId: "test-request-id",
    };
    res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn(),
    };
    next = vi.fn();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("calls next() and attaches user to context with valid JWT", () => {
    const payload = { accountId: "GTEST123" };
    const token = jwt.sign(payload, TEST_JWT_SECRET, { expiresIn: "1h" });
    req.headers.authorization = `Bearer ${token}`;

    authMiddleware(req, res, next);

    expect(next).toHaveBeenCalled();
    expect(req.user.accountId).toBe(payload.accountId);
    expect(res.status).not.toHaveBeenCalled();
  });

  it("returns 401 with token_expired error code for expired JWT", () => {
    const payload = { accountId: "GTEST123" };
    const token = jwt.sign(payload, TEST_JWT_SECRET, { expiresIn: "-1h" }); // Expired
    req.headers.authorization = `Bearer ${token}`;

    authMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: "Authorization token has expired.",
      statusCode: 401,
      requestId: "test-request-id",
      code: "token_expired",
    });
  });

  it("returns 401 with unauthorized error code for no Authorization header", () => {
    authMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: "Missing or invalid authorization header.",
      statusCode: 401,
      requestId: "test-request-id",
      code: "unauthorized",
    });
  });

  it("returns 401 with invalid_token error code for malformed token", () => {
    req.headers.authorization = "Bearer invalid.jwt.token";

    authMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: "Invalid authorization token.",
      statusCode: 401,
      requestId: "test-request-id",
      code: "invalid_token",
    });
  });

  it("returns 401 with unauthorized error code for invalid Authorization header format", () => {
    req.headers.authorization = "InvalidFormat";

    authMiddleware(req, res, next);

    expect(next).not.toHaveBeenCalled();
    expect(res.status).toHaveBeenCalledWith(401);
    expect(res.json).toHaveBeenCalledWith({
      error: "Missing or invalid authorization header.",
      statusCode: 401,
      requestId: "test-request-id",
      code: "unauthorized",
    });
  });
});
