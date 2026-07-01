-- Migration: 0002_add_stream_indexes
-- Purpose : Add covering indexes for the most common stream query patterns.
--           Without these, every filtered query performs a full table scan,
--           which becomes the dominant bottleneck beyond a few thousand rows.
-- Safe to run multiple times: all statements use IF NOT EXISTS.

-- ─────────────────────────────────────────────────────────────
-- 1. sender  – used by GET /api/streams?sender=… and
--              GET /api/senders/:accountId/streams
-- ─────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_streams_sender
    ON streams(sender);

-- ─────────────────────────────────────────────────────────────
-- 2. recipient – used by GET /api/streams?recipient=… and
--               GET /api/recipients/:accountId/streams
-- ─────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_streams_recipient
    ON streams(recipient);

-- ─────────────────────────────────────────────────────────────
-- 3. status (composite) – the runtime status of a stream is
--   *derived* from three nullable timestamp columns:
--     canceled_at  IS NOT NULL  → canceled
--     completed_at IS NOT NULL  → completed
--     paused_at    IS NOT NULL  → paused
--     (all NULL, now < start_at)→ scheduled
--     (all NULL, otherwise)     → active
--
--   A composite index on all three lets SQLite resolve any
--   status filter without touching the main table.
-- ─────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_streams_status
    ON streams(canceled_at, completed_at, paused_at);

-- ─────────────────────────────────────────────────────────────
-- 4. start_at – used for scheduled/active window queries and
--              ORDER BY / range scans on start time
-- ─────────────────────────────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_streams_start_at
    ON streams(start_at);