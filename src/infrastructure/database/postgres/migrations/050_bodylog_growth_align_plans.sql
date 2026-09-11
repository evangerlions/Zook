-- Migration: 050_bodylog_growth_align_plans
-- Align bodylog_seven_day_plans schema with the growth service query code.
-- The query layer (postgres-bodylog-growth.ts) expects columns
-- start_date, end_date, completed_missions, total_missions and does not set app_id.
-- The original 032 migration created app_id NOT NULL and omitted the four columns above.
-- Written idempotently so it is safe to re-run on every startup.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bodylog_seven_day_plans' AND column_name = 'start_date'
  ) THEN
    ALTER TABLE bodylog_seven_day_plans ADD COLUMN start_date TIMESTAMPTZ;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bodylog_seven_day_plans' AND column_name = 'end_date'
  ) THEN
    ALTER TABLE bodylog_seven_day_plans ADD COLUMN end_date TIMESTAMPTZ;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bodylog_seven_day_plans' AND column_name = 'completed_missions'
  ) THEN
    ALTER TABLE bodylog_seven_day_plans ADD COLUMN completed_missions INTEGER NOT NULL DEFAULT 0;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bodylog_seven_day_plans' AND column_name = 'total_missions'
  ) THEN
    ALTER TABLE bodylog_seven_day_plans ADD COLUMN total_missions INTEGER NOT NULL DEFAULT 0;
  END IF;

  -- The query code never populates app_id; make it nullable to avoid NOT NULL violations.
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bodylog_seven_day_plans' AND column_name = 'app_id'
  ) THEN
    ALTER TABLE bodylog_seven_day_plans ALTER COLUMN app_id DROP NOT NULL;
  END IF;
END $$;
