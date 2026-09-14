-- SQLite doesn't support DROP COLUMN directly
-- These would need to be handled by recreating the tables in production
-- For now, we just mark these as rolled back
SELECT 1;
