ALTER TABLE webhook_dead_letters ADD COLUMN stream_id TEXT NOT NULL DEFAULT '';
ALTER TABLE webhook_dead_letters ADD COLUMN event TEXT NOT NULL DEFAULT '';
