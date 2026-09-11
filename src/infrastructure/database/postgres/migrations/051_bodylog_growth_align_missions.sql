-- Migration: 051_bodylog_growth_align_missions
-- Align bodylog_missions schema with the growth service query code.
-- Code expects: day (int), type (varchar), target (int), completed (bool).
-- Original 033 migration created: day_number, mission_type, target_value, current_value, status.
-- Renames are guarded so the migration is safe to re-run on every startup.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bodylog_missions' AND column_name = 'day'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bodylog_missions' AND column_name = 'day_number'
  ) THEN
    ALTER TABLE bodylog_missions RENAME COLUMN day_number TO day;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bodylog_missions' AND column_name = 'type'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bodylog_missions' AND column_name = 'mission_type'
  ) THEN
    ALTER TABLE bodylog_missions RENAME COLUMN mission_type TO type;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bodylog_missions' AND column_name = 'target'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bodylog_missions' AND column_name = 'target_value'
  ) THEN
    ALTER TABLE bodylog_missions RENAME COLUMN target_value TO target;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bodylog_missions' AND column_name = 'completed'
  ) THEN
    ALTER TABLE bodylog_missions ADD COLUMN completed BOOLEAN NOT NULL DEFAULT false;
    UPDATE bodylog_missions SET completed = (status = 'completed');
  END IF;
END $$;
