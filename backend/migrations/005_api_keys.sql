CREATE TABLE IF NOT EXISTS api_keys (
  id                      TEXT PRIMARY KEY,
  name                    TEXT,
  key_hash                TEXT NOT NULL,
  key_prefix              TEXT NOT NULL,
  scope                   TEXT NOT NULL CHECK (scope IN ('read-only', 'read-write')),
  created_at              INTEGER NOT NULL,
  expires_at              INTEGER,
  revoked_at              INTEGER,
  grace_period_expires_at INTEGER,
  rotated_to_id           TEXT
);

CREATE INDEX IF NOT EXISTS idx_api_keys_key_prefix ON api_keys(key_prefix);
