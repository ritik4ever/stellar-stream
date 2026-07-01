ALTER TABLE streams DROP COLUMN paused_at;
ALTER TABLE streams DROP COLUMN paused_duration;

ALTER TABLE stream_archive DROP COLUMN paused_at;
ALTER TABLE stream_archive DROP COLUMN paused_duration;
