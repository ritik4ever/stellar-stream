import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { Keypair, Networks, Transaction } from "@stellar/stellar-sdk";
import jwt from "jsonwebtoken";

let auth: typeof import("./auth");
let outcomes: typeof import("./authChallengeOutcome");

beforeAll(async () => {
  vi.stubEnv("NETWORK_PASSPHRASE", Networks.TESTNET);
  vi.stubEnv("SERVER_SIGNING_KEY", Keypair.random().secret());
  vi.stubEnv("DOMAIN", "localhost");
  auth = await import("./auth");
  outcomes = await import("./authChallengeOutcome");
});

beforeEach(() => {
  auth.clearNonceStoreForTesting();
  outcomes.resetAuthChallengeOutcome();
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue({ ok: false }));
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function signed(challenge: string, client: Keypair, network = Networks.TESTNET) {
  const tx = new Transaction(challenge, network);
  tx.sign(client);
  return tx.toXDR();
}

function holdHorizon() {
  let release!: (response: { ok: boolean }) => void;
  const response = new Promise<{ ok: boolean }>((resolve) => { release = resolve; });
  const fetch = vi.fn().mockReturnValue(response);
  vi.stubGlobal("fetch", fetch);
  return { fetch, release: () => release({ ok: false }) };
}

describe("authentication recovery", () => {
  it("issues one token and one success outcome for overlapping submissions", async () => {
    const client = Keypair.random();
    const xdr = signed(auth.generateChallenge(client.publicKey()), client);
    const horizon = holdHorizon();
    const sign = vi.spyOn(jwt, "sign");
    const record = vi.spyOn(outcomes, "recordAuthChallengeOutcome");
    const attempts = [auth.verifyChallengeAndIssueToken(xdr), auth.verifyChallengeAndIssueToken(xdr)];
    expect(horizon.fetch).toHaveBeenCalledTimes(2);
    const settled = Promise.allSettled(attempts);
    horizon.release();
    const results = await settled;
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toEqual([
      expect.objectContaining({ reason: expect.objectContaining({ message: expect.stringContaining("already been used") }) }),
    ]);
    expect(sign).toHaveBeenCalledTimes(1);
    expect(record.mock.calls.map(([signal]) => signal.outcome)).toEqual(["success", "blocked"]);
    expect([...auth._getNonceStoreForTesting().values()]).toEqual([
      expect.objectContaining({ consumed: true }),
    ]);
  });

  it("keeps the nonce retryable and emits no success when token signing fails", async () => {
    const client = Keypair.random();
    const xdr = signed(auth.generateChallenge(client.publicKey()), client);
    const sign = vi.spyOn(jwt, "sign").mockImplementationOnce(() => { throw new Error("Token signer unavailable"); });
    const record = vi.spyOn(outcomes, "recordAuthChallengeOutcome");
    await expect(auth.verifyChallengeAndIssueToken(xdr)).rejects.toThrow("Token signer unavailable");
    expect(record.mock.calls.map(([signal]) => signal.outcome)).toEqual(["blocked"]);
    expect([...auth._getNonceStoreForTesting().values()][0].consumed).toBe(false);
    await expect(auth.verifyChallengeAndIssueToken(xdr)).resolves.toEqual(expect.any(String));
    expect(sign).toHaveBeenCalledTimes(2);
    expect([...auth._getNonceStoreForTesting().values()][0].consumed).toBe(true);
  });

  it("rejects expiration during Horizon lookup and recovers with a fresh challenge", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    const client = Keypair.random();
    const xdr = signed(auth.generateChallenge(client.publicKey()), client);
    const horizon = holdHorizon();
    const sign = vi.spyOn(jwt, "sign");
    const attempt = auth.verifyChallengeAndIssueToken(xdr);
    expect(horizon.fetch).toHaveBeenCalledTimes(1);
    vi.setSystemTime(Date.now() + 61_000);
    const rejected = expect(attempt).rejects.toThrow("too old");
    horizon.release();
    await rejected;
    expect(sign).not.toHaveBeenCalled();
    expect(outcomes.getLastAuthChallengeSignal()?.reason).toBe("expired_nonce");
    expect([...auth._getNonceStoreForTesting().values()][0].consumed).toBe(false);
    const fresh = signed(auth.generateChallenge(client.publicKey()), client);
    await expect(auth.verifyChallengeAndIssueToken(fresh)).resolves.toEqual(expect.any(String));
  });

  it.each([Networks.PUBLIC, Networks.FUTURENET])("allows retry after signing for %s", async (network) => {
    const client = Keypair.random();
    const original = auth.generateChallenge(client.publicKey());
    const sign = vi.spyOn(jwt, "sign");
    await expect(auth.verifyChallengeAndIssueToken(signed(original, client, network))).rejects.toThrow("wrong network");
    expect(outcomes.getLastAuthChallengeSignal()?.reason).toBe("wrong_network");
    expect(sign).not.toHaveBeenCalled();
    expect([...auth._getNonceStoreForTesting().values()][0].consumed).toBe(false);
    const corrected = signed(original, client);
    const token = await auth.verifyChallengeAndIssueToken(corrected);
    expect(jwt.verify(token, auth.getJwtSecret())).toEqual(expect.objectContaining({ accountId: client.publicKey() }));
    await expect(auth.verifyChallengeAndIssueToken(corrected)).rejects.toThrow("already been used");
    expect(outcomes.getLastAuthChallengeSignal()?.reason).toBe("reused_nonce");
    expect(sign).toHaveBeenCalledTimes(1);
    expect(auth._getNonceStoreForTesting().size).toBe(1);
  });
});
