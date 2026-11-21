import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  Keypair,
  Networks,
  Transaction,
  Account,
  TransactionBuilder,
  Operation,
} from "@stellar/stellar-sdk";

const TEST_JWT_SECRET = "test_jwt_secret_observability_suite";
vi.stubEnv("JWT_SECRET", TEST_JWT_SECRET);
vi.stubEnv("NETWORK_PASSPHRASE", Networks.TESTNET);
vi.stubEnv("DOMAIN", "localhost");

const serverKeypair = Keypair.random();
vi.stubEnv("SERVER_SIGNING_KEY", serverKeypair.secret());

// Import modules under test after env stubs
// @ts-expect-error: Top-level await is supported by Vitest
const {
  verifyChallengeAndIssueToken,
  generateChallenge,
  clearNonceStoreForTesting,
} = await import("./auth");

// @ts-expect-error: Top-level await is supported by Vitest
const {
  getLastAuthChallengeSignal,
  resetAuthChallengeOutcome,
  AUTH_CHALLENGE_OUTCOME_CODES,
} = await import("./authChallengeOutcome");

// @ts-expect-error: Top-level await is supported by Vitest
const {
  authChallengeOutcome,
  authChallengeDurationSeconds,
  authChallengeWrongNetworkTotal,
  authChallengeReplayTotal,
} = await import("./metrics");

// @ts-expect-error: Top-level await is supported by Vitest
const { runWithCorrelation } = await import("../correlationContext");

function signChallenge(
  challengeXdr: string,
  signer: Keypair,
  networkPassphrase: string = Networks.TESTNET,
): string {
  const tx = new Transaction(challengeXdr, networkPassphrase);
  tx.sign(signer);
  return tx.toEnvelope().toXDR("base64");
}

function modifyChallengeOps(
  challengeXdr: string,
  modifications: {
    timestamp?: number;
    nonce?: string;
    removeNonce?: boolean;
    removeTimestamp?: boolean;
  },
): string {
  const originalTx = new Transaction(challengeXdr, Networks.TESTNET);
  const serverAccount = new Account(serverKeypair.publicKey(), "-1");

  const builder = new TransactionBuilder(serverAccount, {
    fee: originalTx.fee,
    networkPassphrase: originalTx.networkPassphrase,
    timebounds: originalTx.timeBounds,
  });

  for (const op of originalTx.operations) {
    if (op.type === "manageData") {
      if (op.name === "timestamp") {
        if (modifications.removeTimestamp) continue;
        if (modifications.timestamp !== undefined) {
          builder.addOperation(
            Operation.manageData({
              name: "timestamp",
              value: modifications.timestamp.toString(),
              source: serverKeypair.publicKey(),
            }),
          );
          continue;
        }
      }
      if (op.name === "nonce") {
        if (modifications.removeNonce) continue;
        if (modifications.nonce !== undefined) {
          builder.addOperation(
            Operation.manageData({
              name: "nonce",
              value: modifications.nonce,
              source: serverKeypair.publicKey(),
            }),
          );
          continue;
        }
      }
      builder.addOperation(
        Operation.manageData({
          name: op.name,
          value: op.value as any,
          source: op.source || serverKeypair.publicKey(),
        }),
      );
    } else {
      builder.addOperation(op as any);
    }
  }

  const newTx = builder.build();
  newTx.sign(serverKeypair);
  return newTx.toEnvelope().toXDR("base64");
}

describe("Authentication Challenge Observability (SSB-2026-164)", () => {
  let clientKeypair: Keypair;

  beforeEach(() => {
    clientKeypair = Keypair.random();
    clearNonceStoreForTesting();
    resetAuthChallengeOutcome();
  });

  describe("Wrong Network Detection & Signals", () => {
    it("emits blocked outcome with wrong_network reason when wallet signs for Networks.PUBLIC", async () => {
      const challenge = generateChallenge(clientKeypair.publicKey());
      // Sign using Networks.PUBLIC instead of the expected Networks.TESTNET
      const signedTx = signChallenge(challenge, clientKeypair, Networks.PUBLIC);

      const wrongNetworkBefore =
        (await authChallengeWrongNetworkTotal.get()).values[0]?.value ?? 0;

      await expect(
        verifyChallengeAndIssueToken(signedTx, {
          correlationId: "req-wrong-net-1",
          streamId: "stream-wrong-net-1",
        }),
      ).rejects.toThrow("wallet signed for wrong network");

      const signal = getLastAuthChallengeSignal();
      expect(signal).not.toBeNull();
      expect(signal!.outcome).toBe("blocked");
      expect(signal!.outcomeCode).toBe(AUTH_CHALLENGE_OUTCOME_CODES.blocked);
      expect(signal!.reason).toBe("wrong_network");
      expect(signal!.expectedNetwork).toBe(Networks.TESTNET);
      expect(signal!.detectedNetwork).toBe(Networks.PUBLIC);
      expect(signal!.isNormalEmpty).toBe(false);
      expect(signal!.latencyMs).toBeGreaterThanOrEqual(0);
      expect(signal!.correlation_id).toBe("req-wrong-net-1");
      expect(signal!.streamId).toBe("stream-wrong-net-1");

      // Verify Prometheus metric increments
      const wrongNetworkAfter =
        (await authChallengeWrongNetworkTotal.get()).values[0]?.value ?? 0;
      expect(wrongNetworkAfter).toBe(wrongNetworkBefore + 1);

      const outcomeGauge = (await authChallengeOutcome.get()).values[0]?.value;
      expect(outcomeGauge).toBe(AUTH_CHALLENGE_OUTCOME_CODES.blocked);
    });

    it("emits blocked outcome with wrong_network reason when wallet signs for Networks.FUTURENET", async () => {
      const challenge = generateChallenge(clientKeypair.publicKey());
      const signedTx = signChallenge(
        challenge,
        clientKeypair,
        Networks.FUTURENET,
      );

      await expect(
        verifyChallengeAndIssueToken(signedTx, {
          correlationId: "req-futurenet",
        }),
      ).rejects.toThrow("wallet signed for wrong network");

      const signal = getLastAuthChallengeSignal();
      expect(signal).not.toBeNull();
      expect(signal!.outcome).toBe("blocked");
      expect(signal!.reason).toBe("wrong_network");
      expect(signal!.detectedNetwork).toBe(Networks.FUTURENET);
      expect(signal!.expectedNetwork).toBe(Networks.TESTNET);
      expect(signal!.correlation_id).toBe("req-futurenet");
    });
  });

  describe("Distinguishing Normal Empty Case from Operational Failure", () => {
    it("classifies unfunded account fallback as normal empty case (isNormalEmpty: true, outcome: success)", async () => {
      const challenge = generateChallenge(clientKeypair.publicKey());
      const signedTx = signChallenge(challenge, clientKeypair, Networks.TESTNET);

      const token = await verifyChallengeAndIssueToken(signedTx, {
        correlationId: "req-unfunded-account",
        streamId: "stream-new-user",
      });

      expect(token).toBeDefined();

      const signal = getLastAuthChallengeSignal();
      expect(signal).not.toBeNull();
      expect(signal!.outcome).toBe("success");
      expect(signal!.outcomeCode).toBe(AUTH_CHALLENGE_OUTCOME_CODES.success);
      expect(signal!.reason).toBe("normal_empty_account");
      expect(signal!.isNormalEmpty).toBe(true);
      expect(signal!.accountId).toBe(clientKeypair.publicKey());
      expect(signal!.correlation_id).toBe("req-unfunded-account");
      expect(signal!.streamId).toBe("stream-new-user");
      expect(signal!.latencyMs).toBeGreaterThanOrEqual(0);

      const outcomeGauge = (await authChallengeOutcome.get()).values[0]?.value;
      expect(outcomeGauge).toBe(AUTH_CHALLENGE_OUTCOME_CODES.success);
    });
  });

  describe("Replay Attack vs Expired Nonce Classification", () => {
    it("classifies timestamp drift / expired challenge as transient_delay (code 1)", async () => {
      const oldTimestamp = Math.floor(Date.now() / 1000) - 120;
      let challenge = generateChallenge(clientKeypair.publicKey());
      challenge = modifyChallengeOps(challenge, { timestamp: oldTimestamp });
      const signedTx = signChallenge(challenge, clientKeypair);

      await expect(
        verifyChallengeAndIssueToken(signedTx, {
          correlationId: "req-expired-nonce",
        }),
      ).rejects.toThrow("Challenge timestamp is too old or too far in the future");

      const signal = getLastAuthChallengeSignal();
      expect(signal).not.toBeNull();
      expect(signal!.outcome).toBe("transient_delay");
      expect(signal!.outcomeCode).toBe(
        AUTH_CHALLENGE_OUTCOME_CODES.transient_delay,
      );
      expect(signal!.reason).toBe("expired_nonce");
      expect(signal!.isNormalEmpty).toBe(false);
      expect(signal!.correlation_id).toBe("req-expired-nonce");

      const outcomeGauge = (await authChallengeOutcome.get()).values[0]?.value;
      expect(outcomeGauge).toBe(AUTH_CHALLENGE_OUTCOME_CODES.transient_delay);
    });

    it("classifies reused nonce as blocked (code 2) and increments replay counter", async () => {
      const fixedNonce = "abc123fixednonce4567890123456789";
      let challenge1 = generateChallenge(clientKeypair.publicKey());
      challenge1 = modifyChallengeOps(challenge1, { nonce: fixedNonce });
      const signedTx1 = signChallenge(challenge1, clientKeypair);

      const replayBefore =
        (await authChallengeReplayTotal.get()).values[0]?.value ?? 0;

      // First verification succeeds
      const token1 = await verifyChallengeAndIssueToken(signedTx1);
      expect(token1).toBeDefined();

      // Second verification with identical nonce is a replay attack
      let challenge2 = generateChallenge(clientKeypair.publicKey());
      challenge2 = modifyChallengeOps(challenge2, { nonce: fixedNonce });
      const signedTx2 = signChallenge(challenge2, clientKeypair);

      await expect(
        verifyChallengeAndIssueToken(signedTx2, {
          correlationId: "req-replay-attack",
        }),
      ).rejects.toThrow("Challenge nonce has already been used");

      const signal = getLastAuthChallengeSignal();
      expect(signal).not.toBeNull();
      expect(signal!.outcome).toBe("blocked");
      expect(signal!.outcomeCode).toBe(AUTH_CHALLENGE_OUTCOME_CODES.blocked);
      expect(signal!.reason).toBe("reused_nonce");
      expect(signal!.isNormalEmpty).toBe(false);
      expect(signal!.correlation_id).toBe("req-replay-attack");

      const replayAfter =
        (await authChallengeReplayTotal.get()).values[0]?.value ?? 0;
      expect(replayAfter).toBe(replayBefore + 1);

      const outcomeGauge = (await authChallengeOutcome.get()).values[0]?.value;
      expect(outcomeGauge).toBe(AUTH_CHALLENGE_OUTCOME_CODES.blocked);
    });
  });

  describe("AsyncLocalStorage Correlation Linking", () => {
    it("inherits correlation_id automatically from AsyncLocalStorage context", async () => {
      const challenge = generateChallenge(clientKeypair.publicKey());
      const signedTx = signChallenge(challenge, clientKeypair);

      await runWithCorrelation("async-local-storage-correlation-id", async () => {
        await verifyChallengeAndIssueToken(signedTx);
      });

      const signal = getLastAuthChallengeSignal();
      expect(signal).not.toBeNull();
      expect(signal!.correlation_id).toBe("async-local-storage-correlation-id");
    });
  });

  describe("Credential & Secret Redaction Safety", () => {
    it("never logs or exposes client secret key or server secret in signals or detail strings", async () => {
      const challenge = generateChallenge(clientKeypair.publicKey());
      const signedTx = signChallenge(challenge, clientKeypair, Networks.PUBLIC);

      await expect(
        verifyChallengeAndIssueToken(signedTx, {
          correlationId: "req-secret-check",
        }),
      ).rejects.toThrow();

      const signal = getLastAuthChallengeSignal();
      expect(signal).not.toBeNull();

      // Verify no Stellar secret key (starts with 'S') is leaked
      const clientSecret = clientKeypair.secret();
      const serverSecret = serverKeypair.secret();

      const signalJson = JSON.stringify(signal);
      expect(signalJson).not.toContain(clientSecret);
      expect(signalJson).not.toContain(serverSecret);
      expect(signalJson).not.toMatch(/\bS[A-Z0-9]{55}\b/);

      // Only public account ID (starts with 'G') is permitted
      expect(signal!.accountId).toBe(clientKeypair.publicKey());
      expect(signal!.accountId).toMatch(/^G[A-Z0-9]{55}$/);
    });
  });
});
