-- Additive: older clients ignore guidance; rollback preserves task instructions.
ALTER TABLE zook_lighttick_tasks ADD COLUMN IF NOT EXISTS guidance JSONB NOT NULL DEFAULT '{}'::jsonb;
