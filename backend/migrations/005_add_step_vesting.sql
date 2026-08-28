ALTER TABLE streams ADD COLUMN step_duration_seconds INTEGER;
ALTER TABLE streams ADD COLUMN step_count INTEGER;

ALTER TABLE stream_archive ADD COLUMN step_duration_seconds INTEGER;
ALTER TABLE stream_archive ADD COLUMN step_count INTEGER;
