-- Preserve legacy consent and raw draft anchors without exposing private data via reading consent.
ALTER TABLE zook_lighttick_learning_authorities ADD COLUMN IF NOT EXISTS reading_enabled BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE zook_lighttick_learning_authorities ADD COLUMN IF NOT EXISTS private_enabled BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE zook_lighttick_native_learning_private ADD COLUMN IF NOT EXISTS draft_version TEXT;
ALTER TABLE zook_lighttick_native_lessons ADD COLUMN IF NOT EXISTS source_completed BOOLEAN NOT NULL DEFAULT FALSE;
