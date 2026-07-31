-- Migration down: 0003_add_indexer_cursor
-- Purpose : Remove the indexer checkpoint table.

DROP TABLE IF EXISTS indexer_cursor;
