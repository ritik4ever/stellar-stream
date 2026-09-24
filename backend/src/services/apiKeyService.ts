import bcrypt from "bcryptjs";
import crypto from "crypto";
import { getDb } from "./db";

export type ApiKeyScope = "read-only" | "read-write";

export interface ApiKeyRecord {
  id: string;
  name: string | null;
  key_hash: string;
  key_prefix: string;
  scope: ApiKeyScope;
  created_at: number;
  expires_at: number | null;
  revoked_at: number | null;
  grace_period_expires_at: number | null;
  rotated_to_id: string | null;
}

export interface ApiKeyCreateOptions {
  name?: string;
  scope?: ApiKeyScope;
  expiresInDays?: number;
}

export interface ApiKeyCreateResult {
  id: string;
  name: string | null;
  key: string; // Raw unmasked key returned ONCE at creation
  key_prefix: string;
  scope: ApiKeyScope;
  created_at: number;
  expires_at: number | null;
}

export interface ApiKeyMasked {
  id: string;
  name: string | null;
  key_prefix: string;
  scope: ApiKeyScope;
  created_at: number;
  expires_at: number | null;
  revoked_at: number | null;
  is_active: boolean;
  grace_period_expires_at: number | null;
  rotated_to_id: string | null;
}

export interface ApiKeyRotateOptions {
  gracePeriodSeconds?: number;
}

export interface ApiKeyRotateResult {
  oldKeyId: string;
  newKey: ApiKeyCreateResult;
  gracePeriodExpiresAt: number;
}

function generateRawKey(): string {
  return `ss_live_${crypto.randomBytes(24).toString("hex")}`;
}


function generateMaskedPrefix(rawKey: string): string {
  const prefix = rawKey.slice(0, 12);
  const suffix = rawKey.slice(-4);
  return `${prefix}...${suffix}`;
}

export function createApiKey(options?: ApiKeyCreateOptions): ApiKeyCreateResult {
  const id = `key_${crypto.randomBytes(8).toString("hex")}`;
  const rawKey = generateRawKey();
  const keyPrefix = generateMaskedPrefix(rawKey);
  const keyHash = bcrypt.hashSync(rawKey, 10);
  const scope: ApiKeyScope = options?.scope === "read-only" ? "read-only" : "read-write";
  const createdAt = Math.floor(Date.now() / 1000);
  const expiresAt = options?.expiresInDays ? createdAt + options.expiresInDays * 86400 : null;

  const db = getDb();
  db.prepare(`
    INSERT INTO api_keys (
      id, name, key_hash, key_prefix, scope, created_at, expires_at
    ) VALUES (
      @id, @name, @key_hash, @key_prefix, @scope, @created_at, @expires_at
    )
  `).run({
    id,
    name: options?.name ? options.name.trim() : null,
    key_hash: keyHash,
    key_prefix: keyPrefix,
    scope,
    created_at: createdAt,
    expires_at: expiresAt,
  });

  return {
    id,
    name: options?.name ? options.name.trim() : null,
    key: rawKey,
    key_prefix: keyPrefix,
    scope,
    created_at: createdAt,
    expires_at: expiresAt,
  };
}

export function listActiveApiKeys(includeRevoked: boolean = false): ApiKeyMasked[] {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  const sql = includeRevoked
    ? "SELECT * FROM api_keys ORDER BY created_at DESC"
    : "SELECT * FROM api_keys WHERE revoked_at IS NULL ORDER BY created_at DESC";

  const rows = db.prepare(sql).all() as ApiKeyRecord[];

  return rows.map((row) => {
    const isRevoked = row.revoked_at !== null;
    const isExpired = row.expires_at !== null && row.expires_at <= now;
    const isGracePeriodEnded =
      row.grace_period_expires_at !== null && row.grace_period_expires_at <= now;
    const isActive = !isRevoked && !isExpired && !isGracePeriodEnded;

    return {
      id: row.id,
      name: row.name ?? null,
      key_prefix: row.key_prefix,
      scope: row.scope,
      created_at: row.created_at,
      expires_at: row.expires_at ?? null,
      revoked_at: row.revoked_at ?? null,
      is_active: isActive,
      grace_period_expires_at: row.grace_period_expires_at ?? null,
      rotated_to_id: row.rotated_to_id ?? null,
    };
  });
}

export function getApiKeyById(id: string): ApiKeyRecord | null {
  const db = getDb();
  const row = db.prepare("SELECT * FROM api_keys WHERE id = @id").get({ id }) as ApiKeyRecord | undefined;
  return row ?? null;
}

export function revokeApiKey(id: string): boolean {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  const result = db.prepare(`
    UPDATE api_keys
    SET revoked_at = @now
    WHERE id = @id AND revoked_at IS NULL
  `).run({ id, now });

  return result.changes > 0;
}

export function rotateApiKey(id: string, options?: ApiKeyRotateOptions): ApiKeyRotateResult | null {
  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  const existing = getApiKeyById(id);
  if (!existing || existing.revoked_at !== null) {
    return null;
  }

  const gracePeriodSeconds = options?.gracePeriodSeconds ?? 86400; // default 24h grace period
  const gracePeriodExpiresAt = now + gracePeriodSeconds;

  const newKey = createApiKey({
    scope: existing.scope,
    name: existing.name ? `${existing.name} (rotated)` : undefined,
  });

  db.prepare(`
    UPDATE api_keys
    SET grace_period_expires_at = @gracePeriodExpiresAt,
        rotated_to_id = @newKeyId
    WHERE id = @id
  `).run({
    gracePeriodExpiresAt,
    newKeyId: newKey.id,
    id,
  });

  return {
    oldKeyId: id,
    newKey,
    gracePeriodExpiresAt,
  };
}

export function verifyApiKey(rawKey: string): ApiKeyRecord | null {
  if (!rawKey || typeof rawKey !== "string" || !rawKey.startsWith("ss_live_")) {
    return null;
  }


  const db = getDb();
  const now = Math.floor(Date.now() / 1000);

  // Fetch non-revoked candidate keys
  const rows = db.prepare(`
    SELECT * FROM api_keys WHERE revoked_at IS NULL
  `).all() as ApiKeyRecord[];

  for (const candidate of rows) {
    // Check if key is expired
    if (candidate.expires_at !== null && now > candidate.expires_at) {
      continue;
    }

    // Check if grace period has expired
    if (candidate.grace_period_expires_at !== null && now > candidate.grace_period_expires_at) {
      continue;
    }

    // Compare bcrypt hash
    if (bcrypt.compareSync(rawKey, candidate.key_hash)) {
      return candidate;
    }
  }

  return null;
}
