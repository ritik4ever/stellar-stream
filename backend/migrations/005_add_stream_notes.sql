CREATE TABLE IF NOT EXISTS stream_notes (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  stream_id       TEXT NOT NULL,
  author          TEXT NOT NULL,
  content         TEXT NOT NULL,
  created_at      INTEGER NOT NULL,
  FOREIGN KEY (stream_id) REFERENCES streams(id)
);

CREATE INDEX IF NOT EXISTS idx_stream_notes_stream_id ON stream_notes(stream_id);
