-- Migration: 033_bodylog_missions
-- Description: Create table for daily missions in 7-day plan
-- Date: 2026-08-27

CREATE TABLE IF NOT EXISTS bodylog_missions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id UUID NOT NULL,
  day_number INTEGER NOT NULL CHECK (day_number BETWEEN 1 AND 7),
  mission_type VARCHAR(50) NOT NULL,
  target_value INTEGER NOT NULL,
  current_value INTEGER NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'completed', 'failed')),
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT fk_bodylog_missions_plan
    FOREIGN KEY (plan_id)
    REFERENCES bodylog_seven_day_plans(id)
    ON DELETE CASCADE,

  CONSTRAINT uq_bodylog_missions_plan_day
    UNIQUE (plan_id, day_number)
);

CREATE INDEX IF NOT EXISTS idx_bodylog_missions_plan_id ON bodylog_missions(plan_id);
CREATE INDEX IF NOT EXISTS idx_bodylog_missions_status ON bodylog_missions(status);
COMMENT ON TABLE bodylog_missions IS 'Daily missions for 7-day plans';
-- Later migrations rename these columns; startup replays this file too.
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'bodylog_missions' AND column_name = 'day_number') THEN
    CREATE INDEX IF NOT EXISTS idx_bodylog_missions_day ON bodylog_missions(day_number);
  END IF;
END $$;
