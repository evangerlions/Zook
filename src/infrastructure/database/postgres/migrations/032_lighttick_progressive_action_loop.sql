-- Additive fields for LightTick action-first onboarding and recovery. Existing
-- plan-first rows remain valid and receive neutral defaults.
ALTER TABLE zook_lighttick_goals
  ADD COLUMN IF NOT EXISTS pause_metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS recovery_started_at TIMESTAMPTZ;

ALTER TABLE zook_lighttick_tasks
  ADD COLUMN IF NOT EXISTS lineage_id TEXT,
  ADD COLUMN IF NOT EXISTS selected_variant TEXT NOT NULL DEFAULT 'standard',
  ADD COLUMN IF NOT EXISTS variant_definitions JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS completion_criteria TEXT,
  ADD COLUMN IF NOT EXISTS actual_minutes INTEGER,
  ADD COLUMN IF NOT EXISTS commitment_satisfied BOOLEAN;

UPDATE zook_lighttick_tasks SET lineage_id = id WHERE lineage_id IS NULL;
ALTER TABLE zook_lighttick_tasks ALTER COLUMN lineage_id SET NOT NULL;

DO $$ BEGIN
  ALTER TABLE zook_lighttick_tasks ADD CONSTRAINT zook_lighttick_task_variant_check
    CHECK (selected_variant IN ('standard', 'light', 'minimum'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE zook_lighttick_tasks ADD CONSTRAINT zook_lighttick_actual_minutes_check
    CHECK (actual_minutes IS NULL OR actual_minutes BETWEEN 1 AND 1440);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS zook_lighttick_tasks_owner_lineage_idx
  ON zook_lighttick_tasks (app_id, user_id, lineage_id);
