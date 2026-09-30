/**
 * Secrets Rotation Smoke Check — repeatable verification for RUNBOOK.md
 * (Rotate JWT Secret / Rotate Server Signing Key).
 *
 * One command, one verdict:
 *
 *     cd backend && npm run smoke:rotation
 *
 * The run boots the real API twice — once with the current credentials and
 * once with the rotated credentials — so the checks below exercise the exact
 * windows an operator sees during a rollout:
 *
 *   phase 1  baseline        the old JWT and the old server signing key work
 *   phase 2  rollout window  old and new instances overlap; an old credential
 *            presented to a rotated instance (and a new credential presented to
 *            an instance that has not restarted) must be rejected
 *   phase 3  cutover         only the rotated instance remains; the cutover time
 *            (restart -> old credential rejected) is measured and must stay
 *            inside CUTOVER_BUDGET_MS, and every signature is verified
 *            cryptographically against the credential that is in force
 *
 * Every check is recorded and printed as PASS/FAIL with a final
 * `RESULT: PASS (n/n checks)` line, so the output is safe to paste into a PR or
 * an incident channel: it carries timings and pass/fail only, never a secret.
 * A single failing check fails the run (non-zero exit).
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import {
  Keypair,
  Networks,
  Transaction,
} from "@stellar/stellar-sdk";
import path from "path";
import fs from "fs";
import { performance } from "perf_hooks";

// ─────────────────────────────────────────────────────────────────────────────
// Rotation fixtures (throwaway values, never used outside this process)
// ─────────────────────────────────────────────────────────────────────────────

const OLD_JWT_SECRET = "smoke_old_jwt_secret_32_chars_minimum!!";
const NEW_JWT_SECRET = "smoke_new_jwt_secret_32_chars_minimum!!";

const OLD_SERVER_KEY = Keypair.random();
const NEW_SERVER_KEY = Keypair.random();

const CLIENT = Keypair.random();

/**
 * Budget for the cutover: from "restart with the new credentials" to "the old
 * credential is rejected by the rotated instance". The rotation is a process
 * restart plus one request, so anything beyond this budget means the rollout is
 * stuck and the operator should stop and roll back (see RUNBOOK.md).
 */
const CUTOVER_BUDGET_MS = 30_000;

const DATA_DIR = path.join(__dirname, "..", "..", "data");
const DB_FILES = [
  path.join(DATA_DIR, "smoke-rotation-old.db"),
  path.join(DATA_DIR, "smoke-rotation-new.db"),
];

// ─────────────────────────────────────────────────────────────────────────────
// Check bookkeeping — drives the PASS/FAIL report
// ─────────────────────────────────────────────────────────────────────────────

type Check = { phase: string; name: string; ok: boolean; detail?: string };
const checks: Check[] = [];
let cutoverMs: number | null = null;

function record(phase: string, name: string, ok: boolean, detail?: string) {
  checks.push({ phase, name, ok, detail });
  return ok;
}

// ─────────────────────────────────────────────────────────────────────────────
// Instance helper — simulates one running backend with a given credential set
// ─────────────────────────────────────────────────────────────────────────────

type Instance = Awaited<ReturnType<typeof bootInstance>>;

async function bootInstance(
  jwtSecret: string,
  serverSigningKey: string,
  dbFile: string,
) {
  // Drop the module graph so credentials are re-read exactly the way a
  // process restart re-reads them (both are captured at module load).
  vi.resetModules();

  process.env.JWT_SECRET = jwtSecret;
  process.env.SERVER_SIGNING_KEY = serverSigningKey;
  process.env.DB_PATH = dbFile;
  process.env.NETWORK_PASSPHRASE = Networks.TESTNET;
  process.env.DOMAIN = "localhost";
  // Keep the report readable: request logs are noise for a pass/fail check.
  process.env.LOG_LEVEL = "silent";

  const { app } = await import("../index");
  const { initDb, getDb } = await import("./db");
  const { initCache, getCache } = await import("./cache");
  const { generateChallenge, verifyChallengeAndIssueToken, getJwtSecret } =
    await import("./auth");

  initDb();
  initCache();

  return {
    app,
    getDb,
    getCache,
    getJwtSecret,
    generateChallenge,
    verifyChallengeAndIssueToken,
    serverPublicKey: Keypair.fromSecret(serverSigningKey).publicKey(),
    jwtSecret,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Signature helpers — explicit cryptographic verification, not just HTTP status
// ─────────────────────────────────────────────────────────────────────────────

/** True when `challengeXdr` carries a valid server signature from `publicKey`. */
function challengeSignedBy(challengeXdr: string, publicKey: string): boolean {
  try {
    const tx = new Transaction(challengeXdr, Networks.TESTNET);
    if (tx.signatures.length === 0) return false;
    const hash = tx.hash();
    return tx.signatures.some((sig) => {
      try {
        // stellar-base exposes the raw bytes either as a `signature()` method
        // or as a `signature` property, depending on the SDK version.
        const raw = sig.signature as unknown as Buffer | (() => Buffer);
        const bytes = typeof raw === "function" ? raw() : raw;
        return Keypair.fromPublicKey(publicKey).verify(hash, bytes);
      } catch {
        return false;
      }
    });
  } catch {
    return false;
  }
}

function makeToken(accountId: string, secret: string): string {
  return jwt.sign({ accountId }, secret, { expiresIn: "1h" });
}

/** Request a challenge from `instance` and sign it with the test client. */
function signChallenge(instance: Instance): string {
  const challenge = instance.generateChallenge(CLIENT.publicKey());
  const tx = new Transaction(challenge, Networks.TESTNET);
  tx.sign(CLIENT);
  return tx.toEnvelope().toXDR("base64");
}

/** Call an auth-protected route and report the status code. */
async function bearerStatus(
  instance: Instance,
  token: string,
): Promise<number> {
  const res = await request(instance.app)
    .get("/api/webhooks/dead-letters/count")
    .set("Authorization", `Bearer ${token}`);
  return res.status;
}

// ─────────────────────────────────────────────────────────────────────────────
// Report
// ─────────────────────────────────────────────────────────────────────────────

function printReport() {
  const width = Math.max(...checks.map((c) => c.name.length), 10);
  const lines: string[] = [];
  lines.push("");
  lines.push(
    "Secrets rotation smoke check (RUNBOOK.md → Rotate JWT Secret / Rotate Server Signing Key)",
  );
  lines.push("─".repeat(width + 44));

  let phase = "";
  for (const check of checks) {
    if (check.phase !== phase) {
      phase = check.phase;
      lines.push(`  ${phase}`);
    }
    lines.push(
      `    ${check.ok ? "PASS" : "FAIL"}  ${check.name.padEnd(width)}${
        check.detail ? `  ${check.detail}` : ""
      }`,
    );
  }

  const passed = checks.filter((c) => c.ok).length;
  lines.push("─".repeat(width + 44));
  lines.push(
    `  cutover time: ${
      cutoverMs === null ? "not measured" : `${cutoverMs} ms`
    } (budget ${CUTOVER_BUDGET_MS} ms)`,
  );
  lines.push(
    `  RESULT: ${passed === checks.length ? "PASS" : "FAIL"} (${passed}/${checks.length} checks)`,
  );
  lines.push("");
  // Counts, timings and pass/fail only — never a credential value.
  // Written straight to stdout so the verdict shows up regardless of which
  // vitest reporter is in use (console output is only surfaced on failures).
  process.stdout.write(`${lines.join("\n")}\n`);
}

// ─────────────────────────────────────────────────────────────────────────────
// Suite
// ─────────────────────────────────────────────────────────────────────────────

describe("Secrets rotation smoke check", () => {
  let current: Instance; // pre-rotation instance (old credentials)
  let rotated: Instance | null = null; // post-rotation instance (new credentials)

  const oldToken = () => makeToken(CLIENT.publicKey(), OLD_JWT_SECRET);
  const newToken = () => makeToken(CLIENT.publicKey(), NEW_JWT_SECRET);

  beforeAll(async () => {
    for (const file of DB_FILES) {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    }
    current = await bootInstance(
      OLD_JWT_SECRET,
      OLD_SERVER_KEY.secret(),
      DB_FILES[0],
    );
  }, 60_000);

  afterAll(async () => {
    printReport();
    for (const instance of [current, rotated]) {
      if (!instance) continue;
      try {
        await instance.getCache()?.clear();
        instance.getDb()?.close();
      } catch {
        // already closed
      }
    }
    for (const file of DB_FILES) {
      if (fs.existsSync(file)) fs.unlinkSync(file);
    }
  });

  it("phase 1 — baseline: the old credentials work before rotation", async () => {
    const token = oldToken();

    let verified = false;
    try {
      jwt.verify(token, OLD_JWT_SECRET);
      verified = true;
    } catch {
      verified = false;
    }
    record(
      "phase 1 · baseline (old credentials)",
      "old JWT signature verifies with the old secret",
      verified,
    );

    const status = await bearerStatus(current, token);
    record(
      "phase 1 · baseline (old credentials)",
      "old JWT is accepted by the running instance",
      status !== 401,
      `status ${status}`,
    );

    const challenge = current.generateChallenge(CLIENT.publicKey());
    record(
      "phase 1 · baseline (old credentials)",
      "challenge is signed by the old server signing key",
      challengeSignedBy(challenge, current.serverPublicKey),
    );

    const signed = signChallenge(current);
    let flowOk = false;
    let flowDetail = "";
    try {
      const issued = await current.verifyChallengeAndIssueToken(signed);
      jwt.verify(issued, OLD_JWT_SECRET);
      flowOk = true;
    } catch (error) {
      flowDetail = (error as Error).message.slice(0, 60);
    }
    record(
      "phase 1 · baseline (old credentials)",
      "auth flow issues a JWT signed with the old secret",
      flowOk,
      flowDetail,
    );
  }, 60_000);

  it("phase 2 — rollout window: old credentials are rejected by the rotated instance", async () => {
    const preRotationToken = oldToken();

    // Rotate: restart with the new credentials while the old instance is still
    // serving, which is exactly the overlap window of a rolling deploy.
    const startedAt = performance.now();
    rotated = await bootInstance(
      NEW_JWT_SECRET,
      NEW_SERVER_KEY.secret(),
      DB_FILES[1],
    );

    const status = await bearerStatus(rotated, preRotationToken);
    if (cutoverMs === null) {
      cutoverMs = Math.round(performance.now() - startedAt);
    }
    record(
      "phase 2 · rollout window (old + new instances)",
      "rotated instance rejects the old JWT",
      status === 401,
      `status ${status}`,
    );

    // The instance that has not restarted yet cannot accept a credential
    // minted after cutover either — mixed fleets are the whole hazard.
    const postRotationStatus = await bearerStatus(current, newToken());
    record(
      "phase 2 · rollout window (old + new instances)",
      "not-yet-rotated instance rejects a JWT issued after rotation",
      postRotationStatus === 401,
      `status ${postRotationStatus}`,
    );

    const oldChallenge = signChallenge(current);
    let oldChallengeRejected = false;
    let oldChallengeDetail = "";
    try {
      await rotated.verifyChallengeAndIssueToken(oldChallenge);
    } catch {
      oldChallengeRejected = true;
    }
    record(
      "phase 2 · rollout window (old + new instances)",
      "rotated instance rejects a challenge signed by the old server key",
      oldChallengeRejected,
      oldChallengeDetail,
    );

    record(
      "phase 2 · rollout window (old + new instances)",
      "rotated instance signs new challenges with the new server key",
      challengeSignedBy(
        rotated.generateChallenge(CLIENT.publicKey()),
        NEW_SERVER_KEY.publicKey(),
      ) &&
        !challengeSignedBy(
          rotated.generateChallenge(CLIENT.publicKey()),
          OLD_SERVER_KEY.publicKey(),
        ),
    );
  }, 60_000);

  it("phase 3 — cutover: signatures verify and the old credential stays dead", async () => {
    expect(rotated).not.toBeNull();
    const instance = rotated as Instance;

    record(
      "phase 3 · cutover (rotated instance only)",
      "cutover completed within the documented budget",
      cutoverMs !== null && cutoverMs <= CUTOVER_BUDGET_MS,
      cutoverMs === null ? "not measured" : `${cutoverMs} ms`,
    );

    const oldStatus = await bearerStatus(instance, oldToken());
    record(
      "phase 3 · cutover (rotated instance only)",
      "old JWT is still rejected after cutover",
      oldStatus === 401,
      `status ${oldStatus}`,
    );

    const token = newToken();
    let newVerifies = false;
    let newRejectedByOld = false;
    try {
      jwt.verify(token, NEW_JWT_SECRET);
      newVerifies = true;
    } catch {
      newVerifies = false;
    }
    try {
      jwt.verify(token, OLD_JWT_SECRET);
      newRejectedByOld = false;
    } catch {
      newRejectedByOld = true;
    }
    record(
      "phase 3 · cutover (rotated instance only)",
      "new JWT signature verifies with the new secret and is rejected by the old one",
      newVerifies && newRejectedByOld,
    );

    const newStatus = await bearerStatus(instance, token);
    record(
      "phase 3 · cutover (rotated instance only)",
      "new JWT is accepted by the rotated instance",
      newStatus !== 401,
      `status ${newStatus}`,
    );

    const challenge = instance.generateChallenge(CLIENT.publicKey());
    record(
      "phase 3 · cutover (rotated instance only)",
      "challenge verifies against the new server signing key only",
      challengeSignedBy(challenge, NEW_SERVER_KEY.publicKey()) &&
        !challengeSignedBy(challenge, OLD_SERVER_KEY.publicKey()),
    );

    const signed = signChallenge(instance);
    let flowOk = false;
    let flowDetail = "";
    try {
      const issued = await instance.verifyChallengeAndIssueToken(signed);
      jwt.verify(issued, NEW_JWT_SECRET);
      flowOk = true;
    } catch (error) {
      flowDetail = (error as Error).message.slice(0, 60);
    }
    record(
      "phase 3 · cutover (rotated instance only)",
      "auth flow issues a JWT signed with the new secret",
      flowOk,
      flowDetail,
    );

    // Every recorded check must have passed; the report is printed in afterAll.
    const failed = checks.filter((check) => !check.ok);
    expect(failed, failed.map((c) => `${c.name}${c.detail ? ` (${c.detail})` : ""}`).join("; ")).toEqual(
      [],
    );
  }, 60_000);
});
