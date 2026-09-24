import { describe, it, expect, beforeAll } from "vitest";
import request from "supertest";
import { app } from "./index";
import { initDb, getDb } from "./services/db";
import {
  createApiKey,
  listActiveApiKeys,
  revokeApiKey,
  rotateApiKey,
  verifyApiKey,
} from "./services/apiKeyService";
import bcrypt from "bcryptjs";

describe("API Key Management & X-API-Key Authentication", () => {
  beforeAll(() => {
    initDb();
  });

  describe("API Key Service", () => {
    it("should store API key as a bcrypt hash and generate masked prefix", () => {
      const result = createApiKey({ name: "Service Test Key", scope: "read-write" });
      expect(result.id).toBeDefined();
      expect(result.key).toMatch(/^ss_live_[a-f0-9]{48}$/);
      expect(result.key_prefix).toContain("...");
      expect(result.scope).toBe("read-write");

      const dbRow = getDb()
        .prepare("SELECT * FROM api_keys WHERE id = @id")
        .get({ id: result.id }) as any;

      expect(dbRow).toBeDefined();
      expect(dbRow.key_hash).not.toEqual(result.key);
      expect(bcrypt.compareSync(result.key, dbRow.key_hash)).toBe(true);
    });

    it("should verify valid active API key and reject invalid key", () => {
      const created = createApiKey({ scope: "read-only" });

      const verified = verifyApiKey(created.key);
      expect(verified).not.toBeNull();
      expect(verified?.id).toBe(created.id);
      expect(verified?.scope).toBe("read-only");

      const invalidVerification = verifyApiKey("ss_live_invalidkey1234567890abcdef1234567890abcdef");
      expect(invalidVerification).toBeNull();
    });


    it("should support key rotation with a grace period", () => {
      const initial = createApiKey({ name: "Rotation Test Key", scope: "read-write" });
      const rotationResult = rotateApiKey(initial.id, { gracePeriodSeconds: 300 });

      expect(rotationResult).not.toBeNull();
      expect(rotationResult?.oldKeyId).toBe(initial.id);
      expect(rotationResult?.newKey.id).toBeDefined();

      // Old key should still be verified during grace period
      const verifiedOld = verifyApiKey(initial.key);
      expect(verifiedOld).not.toBeNull();

      // New key should also be verified
      const verifiedNew = verifyApiKey(rotationResult!.newKey.key);
      expect(verifiedNew).not.toBeNull();
    });
  });

  describe("API Endpoints", () => {
    let readOnlyKey: string;
    let readWriteKey: string;
    let createdKeyId: string;

    it("POST /api/api-keys should create a read-only key", async () => {
      const res = await request(app)
        .post("/api/api-keys")
        .send({ scope: "read-only", name: "Read Only Client Key" });

      expect(res.status).toBe(201);
      expect(res.body.data.key).toMatch(/^ss_live_/);
      expect(res.body.data.scope).toBe("read-only");

      readOnlyKey = res.body.data.key;
      createdKeyId = res.body.data.id;
    });

    it("POST /api/api-keys should create a read-write key", async () => {
      const res = await request(app)
        .post("/api/api-keys")
        .send({ scope: "read-write", name: "Read Write Client Key" });

      expect(res.status).toBe(201);
      expect(res.body.data.key).toMatch(/^ss_live_/);
      expect(res.body.data.scope).toBe("read-write");

      readWriteKey = res.body.data.key;
    });


    it("GET /api/api-keys should list active keys with masked key_prefix", async () => {
      const res = await request(app).get("/api/api-keys");

      expect(res.status).toBe(200);
      expect(Array.isArray(res.body.data)).toBe(true);

      const found = res.body.data.find((k: any) => k.id === createdKeyId);
      expect(found).toBeDefined();
      expect(found.key).toBeUndefined(); // Raw key must NOT be returned in list
      expect(found.key_prefix).toBeDefined();
      expect(found.is_active).toBe(true);
    });

    it("X-API-Key auth should reject read-only keys on mutation endpoints", async () => {
      // Endpoint POST /api/api-keys is a mutation endpoint
      const res = await request(app)
        .post("/api/api-keys")
        .set("X-API-Key", readOnlyKey)
        .send({ name: "Attempt Mutation With Read-Only Key" });

      expect(res.status).toBe(403);
      expect(res.body.error).toContain("Read-only API key cannot perform mutations");
    });

    it("X-API-Key auth should allow read-write keys on mutation endpoints", async () => {
      const res = await request(app)
        .post("/api/api-keys")
        .set("X-API-Key", readWriteKey)
        .send({ name: "Allowed Mutation With Read-Write Key", scope: "read-only" });

      expect(res.status).toBe(201);
      expect(res.body.data.id).toBeDefined();
    });

    it("X-API-Key auth should allow read-only keys on read endpoints", async () => {
      const res = await request(app)
        .get("/api/assets")
        .set("X-API-Key", readOnlyKey);

      expect(res.status).toBe(200);
      expect(res.body.data).toBeDefined();
    });

    it("POST /api/api-keys/:id/rotate should rotate a key", async () => {
      const res = await request(app)
        .post(`/api/api-keys/${createdKeyId}/rotate`)
        .send({ gracePeriodSeconds: 60 });

      expect(res.status).toBe(200);
      expect(res.body.data.oldKeyId).toBe(createdKeyId);
      expect(res.body.data.newKey.key).toBeDefined();
    });

    it("DELETE /api/api-keys/:id should revoke an API key", async () => {
      const res = await request(app).delete(`/api/api-keys/${createdKeyId}`);

      expect(res.status).toBe(200);
      expect(res.body.id).toBe(createdKeyId);

      // Verify revoked status in list
      const listRes = await request(app).get("/api/api-keys?include_revoked=true");
      const revokedItem = listRes.body.data.find((k: any) => k.id === createdKeyId);
      expect(revokedItem).toBeDefined();
      expect(revokedItem.is_active).toBe(false);
      expect(revokedItem.revoked_at).not.toBeNull();
    });
  });
});
