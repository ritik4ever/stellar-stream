import { describe, expect, it, vi, beforeEach, afterEach, beforeAll, afterAll } from "vitest";
import request from "supertest";
import path from "path";
import fs from "fs";
import jwt from "jsonwebtoken";
import { Keypair } from "@stellar/stellar-sdk";

const TEST_DB_PATH = path.join(__dirname, "..", "data", "test-assets.db");

describe("Assets API Configuration", () => {
  beforeAll(() => {
    process.env.DB_PATH = TEST_DB_PATH;
    process.env.JWT_SECRET = "test-jwt-secret-key-123456";
    process.env.ADMIN_API_KEY = "test-admin-api-key-32-characters-minimum";
  });

  beforeEach(() => {
    vi.resetModules();
    if (fs.existsSync(TEST_DB_PATH)) {
      try {
        fs.unlinkSync(TEST_DB_PATH);
      } catch (err) {
        // Ignore
      }
    }
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  afterAll(() => {
    if (fs.existsSync(TEST_DB_PATH)) {
      try {
        fs.unlinkSync(TEST_DB_PATH);
      } catch (err) {
        // Ignore
      }
    }
  });

  it("should respect ALLOWED_ASSETS environment variable override and normalize", async () => {
    vi.stubEnv("ALLOWED_ASSETS", "yusd, euRo, testCoin ");
    
    const { initDb } = await import("./services/db");
    initDb();

    // Dynamically import app so it picks up the stubbed environment variable
    const { app } = await import("./index");
    
    const response = await request(app).get("/api/assets");
    
    expect(response.status).toBe(200);
    expect(response.body.data).toEqual(["EURO", "TESTCOIN", "YUSD"]);
  }, 15000);

  it("should deduplicate case-insensitive asset codes while preserving normalized sorted output", async () => {
    vi.stubEnv("ALLOWED_ASSETS", "usdc, USDC, Usdc, xLm, XLm, yusd");

    const { initDb } = await import("./services/db");
    initDb();

    const { app } = await import("./index");

    const response = await request(app).get("/api/assets");

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual(["USDC", "XLM", "YUSD"]);
  }, 15000);

  it("should produce deterministic output for duplicate and mixed-case asset codes across repeated requests", async () => {
    vi.stubEnv("ALLOWED_ASSETS", "YUSD, yusd, Yusd, euro, EURO, xLm");

    const { initDb } = await import("./services/db");
    initDb();

    const { app } = await import("./index");

    const first = await request(app).get("/api/assets");
    const second = await request(app).get("/api/assets");

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body.data).toEqual(["EURO", "XLM", "YUSD"]);
    expect(second.body.data).toEqual(first.body.data);
  }, 15000);

  it("should enforce JWT protection on admin asset endpoints", async () => {
    const { initDb } = await import("./services/db");
    initDb();

    const { app } = await import("./index");

    // GET /api/admin/assets without auth
    const getRes = await request(app).get("/api/admin/assets");
    expect(getRes.status).toBe(401);

    // POST /api/admin/assets without auth
    const postRes = await request(app).post("/api/admin/assets").send({ code: "NEW" });
    expect(postRes.status).toBe(401);

    // DELETE /api/admin/assets/:code without auth
    const deleteRes = await request(app).delete("/api/admin/assets/NEW");
    expect(deleteRes.status).toBe(401);
  });

  it("should reject standard user JWT on admin asset endpoints", async () => {
    const { initDb } = await import("./services/db");
    initDb();

    const { app } = await import("./index");
    const { getJwtSecret } = await import("./services/auth");

    const userToken = jwt.sign({ accountId: Keypair.random().publicKey() }, getJwtSecret(), { expiresIn: "1h" });

    const getRes = await request(app)
      .get("/api/admin/assets")
      .set("Authorization", `Bearer ${userToken}`);
    expect(getRes.status).toBe(403);
    expect(getRes.body.error).toContain("Forbidden");
  });

  it("should allow admin JWT to manage allowed assets", async () => {
    const { initDb } = await import("./services/db");
    initDb();

    const { app } = await import("./index");
    const { getJwtSecret } = await import("./services/auth");

    // Create admin token
    const adminToken = jwt.sign({ role: "admin", accountId: "admin", isAdmin: true }, getJwtSecret(), { expiresIn: "1h" });

    // 1. GET admin assets
    const getRes = await request(app)
      .get("/api/admin/assets")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(getRes.status).toBe(200);
    expect(getRes.body.data).toEqual(["USDC", "XLM"]); // seeded from default env

    // 2. POST add asset
    const postRes = await request(app)
      .post("/api/admin/assets")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ code: "yusd" });
    expect(postRes.status).toBe(200);
    expect(postRes.body.data).toEqual(["USDC", "XLM", "YUSD"]);

    // 3. GET assets publicly
    const publicRes = await request(app).get("/api/assets");
    expect(publicRes.status).toBe(200);
    expect(publicRes.body.data).toEqual(["USDC", "XLM", "YUSD"]);

    // 4. DELETE asset
    const deleteRes = await request(app)
      .delete("/api/admin/assets/xlm")
      .set("Authorization", `Bearer ${adminToken}`);
    expect(deleteRes.status).toBe(200);
    expect(deleteRes.body.data).toEqual(["USDC", "YUSD"]);
  });

  it("should treat admin POST of duplicate or mixed-case asset code as a noop with 200 and stable normalized list", async () => {
    const { initDb } = await import("./services/db");
    initDb();

    const { app } = await import("./index");
    const { getJwtSecret } = await import("./services/auth");

    const adminToken = jwt.sign({ role: "admin", accountId: "admin", isAdmin: true }, getJwtSecret(), { expiresIn: "1h" });

    // Add a mixed-case duplicate of an already allowlisted asset
    const dupRes = await request(app)
      .post("/api/admin/assets")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ code: "usdc" });
    expect(dupRes.status).toBe(200);
    expect(dupRes.body.data).toEqual(["USDC", "XLM"]);

    // Add a new asset with mixed case; result must be normalized and sorted
    const newRes = await request(app)
      .post("/api/admin/assets")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ code: "yUsD" });
    expect(newRes.status).toBe(200);
    expect(newRes.body.data).toEqual(["USDC", "XLM", "YUSD"]);

    // Repeating the same mixed-case addition is idempotent
    const repeatRes = await request(app)
      .post("/api/admin/assets")
      .set("Authorization", `Bearer ${adminToken}`)
      .send({ code: "YUSD" });
    expect(repeatRes.status).toBe(200);
    expect(repeatRes.body.data).toEqual(["USDC", "XLM", "YUSD"]);
  });

  it("should support exchanging ADMIN_API_KEY for an admin JWT token", async () => {
    const { initDb } = await import("./services/db");
    initDb();

    const { app } = await import("./index");

    const response = await request(app)
      .post("/api/admin/auth")
      .send({ apiKey: "test-admin-api-key-32-characters-minimum" });

    expect(response.status).toBe(200);
    expect(response.body.token).toBeDefined();

    // Verify token works
    const token = response.body.token;
    const getRes = await request(app)
      .get("/api/admin/assets")
      .set("Authorization", `Bearer ${token}`);
    expect(getRes.status).toBe(200);
  });

  it("should reject stream creation with non-allowlisted asset (400)", async () => {
    const { initDb } = await import("./services/db");
    initDb();

    const { app } = await import("./index");
    const { getJwtSecret } = await import("./services/auth");

    const userToken = jwt.sign({ accountId: Keypair.random().publicKey() }, getJwtSecret(), { expiresIn: "1h" });
    const sender = Keypair.random().publicKey();
    const recipient = Keypair.random().publicKey();

    // Try to create stream with invalid asset
    const response = await request(app)
      .post("/api/streams")
      .set("Authorization", `Bearer ${userToken}`)
      .send({
        sender,
        recipient,
        assetCode: "BADCOIN",
        totalAmount: 100,
        durationSeconds: 3600
      });
    
    expect(response.status).toBe(400);
    expect(response.body.error).toContain("BADCOIN");
  });

  describe("Normalized sorted asset list consistency rule (SSB-2026-123)", () => {
    it("returns the exact same normalized sorted asset list across GET /api/assets, GET /api/admin/assets, POST /api/admin/assets, and DELETE /api/admin/assets/:code", async () => {
      vi.stubEnv("ALLOWED_ASSETS", "xlm, usdc, XLM, UsDc, eurc");

      const { initDb } = await import("./services/db");
      initDb();

      const { app } = await import("./index");
      const { getJwtSecret } = await import("./services/auth");
      const adminToken = jwt.sign(
        { role: "admin", accountId: "admin", isAdmin: true },
        getJwtSecret(),
        { expiresIn: "1h" },
      );

      const publicGet1 = await request(app).get("/api/assets");
      const adminGet1 = await request(app)
        .get("/api/admin/assets")
        .set("Authorization", `Bearer ${adminToken}`);

      expect(publicGet1.status).toBe(200);
      expect(adminGet1.status).toBe(200);
      expect(publicGet1.body.data).toEqual(["EURC", "USDC", "XLM"]);
      expect(adminGet1.body.data).toEqual(publicGet1.body.data);

      // Add "btc" (sorts before EURC) in mixed case
      const postBtc = await request(app)
        .post("/api/admin/assets")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ code: "  bTc  " });
      expect(postBtc.status).toBe(200);
      expect(postBtc.body.data).toEqual(["BTC", "EURC", "USDC", "XLM"]);

      const adminGet2 = await request(app)
        .get("/api/admin/assets")
        .set("Authorization", `Bearer ${adminToken}`);
      const publicGet2 = await request(app).get("/api/assets");
      expect(adminGet2.body.data).toEqual(["BTC", "EURC", "USDC", "XLM"]);
      expect(publicGet2.body.data).toEqual(["BTC", "EURC", "USDC", "XLM"]);

      // Delete "usdc" in lowercase
      const deleteUsdc = await request(app)
        .delete("/api/admin/assets/usdc")
        .set("Authorization", `Bearer ${adminToken}`);
      expect(deleteUsdc.status).toBe(200);
      expect(deleteUsdc.body.data).toEqual(["BTC", "EURC", "XLM"]);

      const adminGet3 = await request(app)
        .get("/api/admin/assets")
        .set("Authorization", `Bearer ${adminToken}`);
      const publicGet3 = await request(app).get("/api/assets");
      expect(adminGet3.body.data).toEqual(["BTC", "EURC", "XLM"]);
      expect(publicGet3.body.data).toEqual(["BTC", "EURC", "XLM"]);
    });

    it("does not claim a change or alter committed state when POST or DELETE fails validation or storage", async () => {
      vi.stubEnv("ALLOWED_ASSETS", "USDC,XLM");

      const dbModule = await import("./services/db");
      dbModule.initDb();

      const { app } = await import("./index");
      const { getJwtSecret } = await import("./services/auth");
      const adminToken = jwt.sign(
        { role: "admin", accountId: "admin", isAdmin: true },
        getJwtSecret(),
        { expiresIn: "1h" },
      );

      // 1. Invalid asset code on POST must fail with 400 and leave committed state untouched
      const badPost = await request(app)
        .post("/api/admin/assets")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ code: "INVALID$ASSET!" });
      expect(badPost.status).toBe(400);
      expect(badPost.body.data).toBeUndefined();

      // 2. Invalid asset code on DELETE must fail with 400 and leave committed state untouched
      const badDelete = await request(app)
        .delete("/api/admin/assets/INVALID$ASSET!")
        .set("Authorization", `Bearer ${adminToken}`);
      expect(badDelete.status).toBe(400);
      expect(badDelete.body.data).toBeUndefined();

      const afterValidationFailures = await request(app).get("/api/assets");
      expect(afterValidationFailures.body.data).toEqual(["USDC", "XLM"]);

      // 3. Simulated database write failure on POST must return 500 and not claim a change
      const rawDb = dbModule.getDb();
      const origPrepare = rawDb.prepare.bind(rawDb);
      const prepareSpy = vi.spyOn(rawDb, "prepare").mockImplementation((sql: string) => {
        if (sql.includes("INSERT") && sql.includes("allowed_assets")) {
          return {
            run: () => {
              throw new Error("SQLITE_BUSY: database is locked");
            },
          };
        }
        return origPrepare(sql);
      });

      const failedPost = await request(app)
        .post("/api/admin/assets")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ code: "EURC" });
      expect(failedPost.status).toBe(500);
      expect(failedPost.body.data).toBeUndefined();

      prepareSpy.mockRestore();

      // Committed state is still ["USDC", "XLM"] — EURC was never committed
      const afterDbFailure = await request(app).get("/api/assets");
      expect(afterDbFailure.body.data).toEqual(["USDC", "XLM"]);
    });

    it("rejects invalid startup ALLOWED_ASSETS configuration (empty, trailing comma, or malformed codes) without seeding partial state", async () => {
      const { parseAllowedAssetsConfig } = await import("./index");

      expect(() => parseAllowedAssetsConfig("")).toThrow(/ALLOWED_ASSETS/);
      expect(() => parseAllowedAssetsConfig("   ")).toThrow(/ALLOWED_ASSETS/);
      expect(() => parseAllowedAssetsConfig("USDC,")).toThrow(/ALLOWED_ASSETS/);
      expect(() => parseAllowedAssetsConfig("USDC,BAD$CODE")).toThrow(/ALLOWED_ASSETS/);
      expect(parseAllowedAssetsConfig("xlm, usdc, XLM, eurc")).toEqual([
        "EURC",
        "USDC",
        "XLM",
      ]);
    });
  });

  describe("Edge cases in Asset allowlist endpoint (SSB-2026-125)", () => {
    it("handles duplicate and mixed-case asset codes deterministically without duplicate side effects", async () => {
      vi.stubEnv("ALLOWED_ASSETS", "  uSdc , XLM , usdc , Xlm , USDC , EURC , eurc  ");

      const { initDb, getAllowedAssets } = await import("./services/db");
      initDb();

      const { app } = await import("./index");
      const { getJwtSecret } = await import("./services/auth");
      const adminToken = jwt.sign(
        { role: "admin", accountId: "admin", isAdmin: true },
        getJwtSecret(),
        { expiresIn: "1h" },
      );

      // Verify startup state persisted in DB double
      const stored = getAllowedAssets();
      expect(stored).toEqual(["EURC", "USDC", "XLM"]);

      // Verify GET /api/assets status, response structure, and normalized sorted asset list
      const publicRes = await request(app).get("/api/assets");
      expect(publicRes.status).toBe(200);
      expect(publicRes.body).toHaveProperty("data");
      expect(publicRes.body.data).toEqual(["EURC", "USDC", "XLM"]);

      // Admin adding an existing asset with mixed-case and redundant whitespace produces no duplicate side effects
      const dupPostRes = await request(app)
        .post("/api/admin/assets")
        .set("Authorization", `Bearer ${adminToken}`)
        .send({ code: "  xLm  " });
      expect(dupPostRes.status).toBe(200);
      expect(dupPostRes.body.data).toEqual(["EURC", "USDC", "XLM"]);
      expect(getAllowedAssets()).toEqual(["EURC", "USDC", "XLM"]);

      // Deleting case-insensitively removes only the target asset
      const deleteRes = await request(app)
        .delete("/api/admin/assets/UsDc")
        .set("Authorization", `Bearer ${adminToken}`);
      expect(deleteRes.status).toBe(200);
      expect(deleteRes.body.data).toEqual(["EURC", "XLM"]);
      expect(getAllowedAssets()).toEqual(["EURC", "XLM"]);
    });

    it("fails cleanly on invalid configuration on startup with isolated DB double and leaves store unseeded", async () => {
      vi.stubEnv("ALLOWED_ASSETS", "USDC, INVALID_TOOLONG_CODE, XLM");

      const { initDb, getAllowedAssets } = await import("./services/db");
      // initDb calls seedAllowedAssets which throws an error when configuration is invalid
      expect(() => initDb()).toThrow(/Invalid configuration on startup/);

      // DB should not have partial assets seeded
      expect(getAllowedAssets()).toEqual([]);
    });
  });
});
