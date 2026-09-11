-- Migration: 053_bodylog_missions_unique_fix
-- The growth code creates multiple missions per day (steps/water/sleep),
-- so the original UNIQUE (plan_id, day) constraint is incompatible.
-- Replace it with UNIQUE (plan_id, day, type). Idempotent / restart-safe.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_bodylog_missions_plan_day'
  ) THEN
    ALTER TABLE bodylog_missions DROP CONSTRAINT uq_bodylog_missions_plan_day;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'uq_bodylog_missions_plan_day_type'
  ) THEN
    ALTER TABLE bodylog_missions
      ADD CONSTRAINT uq_bodylog_missions_plan_day_type UNIQUE (plan_id, day, type);
  END IF;
END $$;
