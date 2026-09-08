-- Migration: 052_bodylog_growth_align_rewards
-- Align bodylog_rewards schema with the growth service query code.
-- Code expects: type (varchar), value (text).
-- Original 034 migration created: reward_type (varchar), reward_value (jsonb).
-- Renames / drops are guarded so the migration is safe to re-run on every startup.

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bodylog_rewards' AND column_name = 'type'
  ) AND EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bodylog_rewards' AND column_name = 'reward_type'
  ) THEN
    ALTER TABLE bodylog_rewards RENAME COLUMN reward_type TO type;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bodylog_rewards' AND column_name = 'value'
  ) THEN
    ALTER TABLE bodylog_rewards ADD COLUMN value TEXT;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bodylog_rewards' AND column_name = 'reward_value'
  ) THEN
    UPDATE bodylog_rewards
    SET value = reward_value::text
    WHERE value IS NULL AND reward_value IS NOT NULL;
  END IF;
END $$;
