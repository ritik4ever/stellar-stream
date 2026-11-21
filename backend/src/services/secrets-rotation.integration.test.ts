/**
 * Secrets Rotation Validation Tests
 *
 * Validates that rotating JWT_SECRET and SERVER_SIGNING_KEY from a clean
 * environment works as expected. These tests exercise the documented rotation
 * procedures and confirm behavior matches RUNBOOK.md and README.md.
 *
 * Key behaviors verified:
 * 1. JWT_SECRET rotation invalidates all existing tokens
 * 2. SERVER_SIGNING_KEY rotation invalidates all existing challenges
 * 3. Rotation requires service restart (secrets are loaded at startup)
 * 4. New tokens/challenges work correctly after rotation
 */

import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import request from "supertest";
import jwt from "jsonwebtoken";
import { Keypair, Networks, Transaction } from "@stellar/stellar-sdk";
import { initDb, getDb } from "./db";
import { initCache, getCache } from "./cache";
import path from "path";
import fs from "fs";

// Test database path (isolated from other tests)
const TEST_DB_PATH = path.join(
  __dirname,
  "..",
  "data",
  "test-secrets-rotation.db",
);

// Test secrets
const OLD_JWT_SECRET = "old_jwt_secret_for_rotation_test_32chars!!";
const NEW_JWT_SECRET = "new_jwt_secret_for_rotation_test_32chars!!";

const OLD_SERVER_KEYPAIR = Keypair.random();
const NEW_SERVER_KEYPAIR = Keypair.random();

const OLD_SERVER_SIGNING_KEY = OLD_SERVER_KEYPAIR.secret();
const NEW_SERVER_SIGNING_KEY = NEW_SERVER_KEYPAIR.secret();

// Latest secret after the combined-rotation step; used by the outcome-signal
// tests to mint tokens the running app accepts.
const LATEST_JWT_SECRET = "newer_jwt_secret_rotation_test_32chars!!";

// Test client keypair (constant across tests)
const CLIENT_KEYPAIR = Keypair.random();

// ──────────────────────────────────────────────────────────────────────────────
// Helper: Import the app with a specific set of environment variables
// ──────────────────────────────────────────────────────────────────────────────

async function importAppWithEnv(
  jwtSecret: string,
  serverSigningKey: string,
) {
  // Clear module cache to force re-initialization with new env vars
  vi.resetModules();

  // Set environment variables BEFORE importing modules
  process.env.JWT_SECRET = jwtSecret;
  process.env.SERVER_SIGNING_KEY = serverSigningKey;
  process.env.DB_PATH = TEST_DB_PATH;
  process.env.NETWORK_PASSPHRASE = Networks.TESTNET;
  process.env.DOMAIN = "localhost";

  // Import after env is set
  const { app } = await import("../index");
  const { initDb: initDbFn, getDb: getDbFn } = await import("./db");
  const { initCache: initCacheFn, getCache: getCacheFn } = await import("./cache");
  const { getJwtSecret, generateChallenge, verifyChallengeAndIssueToken } = await import("./auth");

  return {
    app,
    initDb: initDbFn,
    getDb: getDbFn,
    initCache: initCacheFn,
    getCache: getCacheFn,
    getJwtSecret,
    generateChallenge,
    verifyChallengeAndIssueToken,
  };
}

// ──────────────────────────────────────────────────────────────────────────────
// Token/Challenge helpers
// ──────────────────────────────────────────────────────────────────────────────

function makeValidToken(accountId: string, secret: string): string {
  return jwt.sign({ accountId }, secret, { expiresIn: "1h" });
}

function makeExpiredToken(accountId: string, secret: string): string {
  return jwt.sign({ accountId }, secret, { expiresIn: "-1h" });
}

async function getChallengeAndSign(
  generateChallenge: (accountId: string) => string,
  clientKeypair: Keypair,
): Promise<string> {
  const challenge = generateChallenge(clientKeypair.publicKey());
  const tx = new Transaction(challenge, Networks.TESTNET);
  tx.sign(clientKeypair);
  return tx.toEnvelope().toXDR("base64");
}

// ──────────────────────────────────────────────────────────────────────────────
// Test Suite
// ──────────────────────────────────────────────────────────────────────────────

describe("Secrets Rotation Validation", () => {
  let modules: Awaited<ReturnType<typeof importAppWithEnv>>;

  // Save reference to modules with old secrets for SERVER_SIGNING_KEY tests
  let oldServerModules: Awaited<ReturnType<typeof importAppWithEnv>>;

  beforeAll(async () => {
    // Clean up any existing test database
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }

    // Import with OLD secrets
    modules = await importAppWithEnv(OLD_JWT_SECRET, OLD_SERVER_SIGNING_KEY);

    // Initialize database and cache
    modules.initDb();
    modules.initCache();

    // Save reference for SERVER_SIGNING_KEY tests
    oldServerModules = modules;
  });

  afterAll(() => {
    try {
      const db = modules.getDb();
      if (db) db.close();
    } catch {
      // Already closed
    }
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.unlinkSync(TEST_DB_PATH);
    }
  });

  describe("JWT_SECRET Rotation", () => {
    let oldValidToken: string;
    let newValidToken: string;

    it("creates valid token with old secret", () => {
      oldValidToken = makeValidToken(CLIENT_KEYPAIR.publicKey(), OLD_JWT_SECRET);
      const decoded = jwt.verify(oldValidToken, OLD_JWT_SECRET) as any;
      expect(decoded.accountId).toBe(CLIENT_KEYPAIR.publicKey());
    });

    it("old token works with old secret via middleware", async () => {
      const res = await request(modules.app)
        .get("/api/webhooks/dead-letters/count")
        .set("Authorization", `Bearer ${oldValidToken}`);

      // Should pass auth (not 401)
      expect(res.status).not.toBe(401);
    });

    it("rotates JWT_SECRET by restarting with new secret", async () => {
      // Re-import app with NEW secret (simulates restart)
      modules = await importAppWithEnv(NEW_JWT_SECRET, OLD_SERVER_SIGNING_KEY);
      modules.initDb();
      modules.initCache();

      // Verify new secret is active
      expect(modules.getJwtSecret()).toBe(NEW_JWT_SECRET);
    });

    it("old token is rejected after JWT_SECRET rotation", async () => {
      const res = await request(modules.app)
        .get("/api/webhooks/dead-letters/count")
        .set("Authorization", `Bearer ${oldValidToken}`);

      expect(res.status).toBe(401);
      expect(res.body.code).toBe("invalid_token");
    });

    it("new token works with new secret after rotation", async () => {
      newValidToken = makeValidToken(CLIENT_KEYPAIR.publicKey(), NEW_JWT_SECRET);

      const res = await request(modules.app)
        .get("/api/webhooks/dead-letters/count")
        .set("Authorization", `Bearer ${newValidToken}`);

      expect(res.status).not.toBe(401);
    });

    it("expired token is rejected regardless of secret", async () => {
      const expiredToken = makeExpiredToken(CLIENT_KEYPAIR.publicKey(), NEW_JWT_SECRET);
      const res = await request(modules.app)
        .get("/api/webhooks/dead-letters/count")
        .set("Authorization", `Bearer ${expiredToken}`);

      expect(res.status).toBe(401);
      expect(res.body.code).toBe("token_expired");
    });
  });

  describe("SERVER_SIGNING_KEY Rotation", () => {
    let oldSignedChallenge: string;
    let newSignedChallenge: string;

    it("generates and verifies challenge with old server key", async () => {
      // Use the saved oldServerModules which has OLD_SERVER_SIGNING_KEY
      // Generate challenge with old server key
      const challenge = oldServerModules.generateChallenge(CLIENT_KEYPAIR.publicKey());
      const tx = new Transaction(challenge, Networks.TESTNET);
      tx.sign(CLIENT_KEYPAIR);
      oldSignedChallenge = tx.toEnvelope().toXDR("base64");

      // Verify it works with old server key (and old JWT secret)
      const token = await oldServerModules.verifyChallengeAndIssueToken(oldSignedChallenge);
      const decoded = jwt.verify(token, OLD_JWT_SECRET) as any;
      expect(decoded.accountId).toBe(CLIENT_KEYPAIR.publicKey());
    });

    it("rotates SERVER_SIGNING_KEY by restarting with new key", async () => {
      // Re-import app with NEW server signing key (simulates restart)
      modules = await importAppWithEnv(NEW_JWT_SECRET, NEW_SERVER_SIGNING_KEY);
      modules.initDb();
      modules.initCache();

      // Generate a new challenge with the new server key
      newSignedChallenge = await getChallengeAndSign(
        modules.generateChallenge,
        CLIENT_KEYPAIR,
      );
    });

    it("old signed challenge is rejected after SERVER_SIGNING_KEY rotation", async () => {
      // The old challenge was signed by the OLD server key
      // It should fail verification with the NEW server key
      await expect(
        modules.verifyChallengeAndIssueToken(oldSignedChallenge),
      ).rejects.toThrow("Challenge verification failed");
    });

    it("new challenge works with new server key after rotation", async () => {
      const token = await modules.verifyChallengeAndIssueToken(newSignedChallenge);
      const decoded = jwt.verify(token, NEW_JWT_SECRET) as any;
      expect(decoded.accountId).toBe(CLIENT_KEYPAIR.publicKey());
    });
  });

  describe("Combined Rotation (Both Secrets)", () => {
    it("handles rotating both secrets simultaneously", async () => {
      // Create another new set of secrets
      const NEWER_JWT_SECRET = LATEST_JWT_SECRET;
      const NEWER_SERVER_KEYPAIR = Keypair.random();
      const NEWER_SERVER_SIGNING_KEY = NEWER_SERVER_KEYPAIR.secret();

      // Restart with both new secrets
      modules = await importAppWithEnv(NEWER_JWT_SECRET, NEWER_SERVER_SIGNING_KEY);
      modules.initDb();
      modules.initCache();

      // Verify new secrets are active
      expect(modules.getJwtSecret()).toBe(NEWER_JWT_SECRET);

      // Generate challenge and verify
      const challenge = modules.generateChallenge(CLIENT_KEYPAIR.publicKey());
      const tx = new Transaction(challenge, Networks.TESTNET);
      tx.sign(CLIENT_KEYPAIR);
      const signedChallenge = tx.toEnvelope().toXDR("base64");

      const token = await modules.verifyChallengeAndIssueToken(signedChallenge);
      const decoded = jwt.verify(token, NEWER_JWT_SECRET) as any;
      expect(decoded.accountId).toBe(CLIENT_KEYPAIR.publicKey());
    });
  });

  describe("Clean Environment Validation", () => {
    it("starts from a fresh checkout without undocumented local state", async () => {
      // This test validates that we can start from scratch with no prior state
      // and the secrets rotation behavior is reproducible

      const FRESH_JWT_SECRET = "fresh_jwt_secret_for_clean_test_32chars!!";
      const FRESH_SERVER_KEYPAIR = Keypair.random();
      const FRESH_SERVER_SIGNING_KEY = FRESH_SERVER_KEYPAIR.secret();

      // Fresh import - no prior modules loaded in this test
      const freshModules = await importAppWithEnv(
        FRESH_JWT_SECRET,
        FRESH_SERVER_SIGNING_KEY,
      );
      freshModules.initDb();
      freshModules.initCache();

      // Generate token and challenge
      const token = makeValidToken(CLIENT_KEYPAIR.publicKey(), FRESH_JWT_SECRET);
      const challenge = freshModules.generateChallenge(CLIENT_KEYPAIR.publicKey());
      const tx = new Transaction(challenge, Networks.TESTNET);
      tx.sign(CLIENT_KEYPAIR);
      const signedChallenge = tx.toEnvelope().toXDR("base64");

      // Verify token works
      const authRes = await request(freshModules.app)
        .get("/api/webhooks/dead-letters/count")
        .set("Authorization", `Bearer ${token}`);
      expect(authRes.status).not.toBe(401);

      // Verify challenge works
      const verifyToken = await freshModules.verifyChallengeAndIssueToken(signedChallenge);
      const decoded = jwt.verify(verifyToken, FRESH_JWT_SECRET) as any;
      expect(decoded.accountId).toBe(CLIENT_KEYPAIR.publicKey());

      // Cleanup
      try { freshModules.getDb().close(); } catch {}
    });
  });

  describe("Secrets Rotation Outcome Signal (GET /api/secrets-rotation/monitoring)", () => {
    it("reports success after a clean rotation when no stale artifacts are accepted", async () => {
      const res = await request(modules.app)
        .get("/api/secrets-rotation/monitoring")
        .set("Authorization", `Bearer ${makeValidToken(CLIENT_KEYPAIR.publicKey(), LATEST_JWT_SECRET)}`);

      expect(res.status).toBe(200);
      expect(res.body).toMatchObject({
        outcome: "success",
        outcomeCode: 0,
      });
      expect(res.body.rotationCount).toBeGreaterThan(0);
      // Secret-free guarantee: the signal must never echo credential values.
      expect(JSON.stringify(res.body)).not.toContain(LATEST_JWT_SECRET);
    });

    it("reports transient_delay while old-credential artifacts are still accepted", async () => {
      const res = await request(modules.app)
        .get("/api/secrets-rotation/monitoring?stale_accepted=true")
        .set("Authorization", `Bearer ${makeValidToken(CLIENT_KEYPAIR.publicKey(), LATEST_JWT_SECRET)}`);

      expect(res.status).toBe(200);
      expect(res.body.outcome).toBe("transient_delay");
      expect(res.body.outcomeCode).toBe(1);
      expect(res.body.detail).toMatch(/Owner action:/);
      expect(JSON.stringify(res.body)).not.toContain(LATEST_JWT_SECRET);
    });

    it("reports blocked when fresh artifacts are rejected", async () => {
      const res = await request(modules.app)
        .get("/api/secrets-rotation/monitoring?fresh_rejected=true")
        .set("Authorization", `Bearer ${makeValidToken(CLIENT_KEYPAIR.publicKey(), LATEST_JWT_SECRET)}`);

      expect(res.status).toBe(200);
      expect(res.body.outcome).toBe("blocked");
      expect(res.body.outcomeCode).toBe(2);
      expect(res.body.detail).toMatch(/RUNBOOK.md/);
    });

    it("scopes the signal to a credential when requested", async () => {
      const res = await request(modules.app)
        .get("/api/secrets-rotation/monitoring?credential=server_signing_key")
        .set("Authorization", `Bearer ${makeValidToken(CLIENT_KEYPAIR.publicKey(), LATEST_JWT_SECRET)}`);

      expect(res.status).toBe(200);
      expect(res.body.credential).toBe("server_signing_key");
    });

    it("rejects an unknown credential with 400", async () => {
      const res = await request(modules.app)
        .get("/api/secrets-rotation/monitoring?credential=not_a_credential")
        .set("Authorization", `Bearer ${makeValidToken(CLIENT_KEYPAIR.publicKey(), LATEST_JWT_SECRET)}`);

      expect(res.status).toBe(400);
    });

    it("requires authentication", async () => {
      const res = await request(modules.app).get("/api/secrets-rotation/monitoring");
      expect(res.status).toBe(401);
    });
  });
});