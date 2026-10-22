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
    expect(response.body.data).toEqual(["YUSD", "EURO", "TESTCOIN"]);
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
    expect(response.body.error).toContain("BEDCOIN");
  });
});
