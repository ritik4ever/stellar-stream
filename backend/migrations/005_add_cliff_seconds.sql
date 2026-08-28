-- Add cliff_seconds (vesting cliff in seconds) to stream tables.
-- streamStore.ts has written this column since the Soroban create-stream wiring,
-- but no migration ever added it — upserts failed with
-- "table streams has no column named cliff_seconds".
ALTER TABLE streams ADD COLUMN cliff_seconds INTEGER NOT NULL DEFAULT 0;
ALTER TABLE stream_archive ADD COLUMN cliff_seconds INTEGER NOT NULL DEFAULT 0;
