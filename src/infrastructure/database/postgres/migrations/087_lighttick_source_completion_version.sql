-- Reading-source completion is a fact about its published content version, even when private sharing was disabled.
ALTER TABLE zook_lighttick_native_lessons ADD COLUMN IF NOT EXISTS source_completed_version TEXT;
UPDATE zook_lighttick_native_lessons SET source_completed_version=published_version
WHERE source_completed=TRUE AND source_completed_version IS NULL;
