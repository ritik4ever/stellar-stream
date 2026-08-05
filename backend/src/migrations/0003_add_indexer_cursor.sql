-- Migration: 0003_add_indexer_cursor
-- Purpose : Add an indexer checkpoint table to persist the last
--           successfully processed ledger sequence. This allows
--           the indexer to resume from the correct position after
--           a restart, preventing event loss and duplicate processing.
-- Safe to run multiple times: uses CREATE TABLE IF NOT EXISTS
-- and a singleton row pattern (id = 1).

CREATE TABLE IF NOT EXISTS indexer_cursor (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    last_ledger_sequence INTEGER NOT NULL
);
