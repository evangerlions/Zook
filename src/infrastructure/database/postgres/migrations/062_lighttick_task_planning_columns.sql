-- LightTick E1 task planning extensions (evolve 2.2, consumes personalize 1.3 §3).
-- Optional columns on zook_lighttick_tasks: historical rows stay backward
-- compatible (NULL = unknown / single-track / action / no partial outcome).
-- Depends on 061 (family_id references zook_lighttick_task_families.id).
ALTER TABLE zook_lighttick_tasks
  ADD COLUMN IF NOT EXISTS subject_id TEXT,
  ADD COLUMN IF NOT EXISTS kind TEXT NOT NULL DEFAULT 'action',
  ADD COLUMN IF NOT EXISTS waiting JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS partial_outcome JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS family_id TEXT;

DO $$ BEGIN
  ALTER TABLE zook_lighttick_tasks ADD CONSTRAINT zook_lighttick_task_kind_check
    CHECK (kind IN ('action', 'rest', 'waiting'));
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE zook_lighttick_tasks ADD CONSTRAINT zook_lighttick_task_waiting_check
    CHECK (jsonb_typeof(waiting)='object');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE zook_lighttick_tasks ADD CONSTRAINT zook_lighttick_task_partial_check
    CHECK (jsonb_typeof(partial_outcome)='object');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS zook_lighttick_tasks_owner_subject_idx
  ON zook_lighttick_tasks (app_id, user_id, subject_id);
CREATE INDEX IF NOT EXISTS zook_lighttick_tasks_owner_family_idx
  ON zook_lighttick_tasks (app_id, user_id, family_id);