CREATE VIRTUAL TABLE IF NOT EXISTS streams_fts USING fts5(
  stream_id UNINDEXED,
  sender,
  recipient,
  asset_code,
  content=streams,
  content_rowid=rowid
);

CREATE TABLE IF NOT EXISTS allowed_assets (
  code TEXT PRIMARY KEY
);
