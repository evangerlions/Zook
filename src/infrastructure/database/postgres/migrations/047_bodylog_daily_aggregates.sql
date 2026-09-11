-- Migration: 035_bodylog_daily_aggregates
-- Description: Create table for daily activity aggregates
-- Date: 2026-08-27

CREATE TABLE IF NOT EXISTS bodylog_daily_aggregates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(255) NOT NULL,
  date DATE NOT NULL,
  total_steps INTEGER NOT NULL DEFAULT 0,
  total_water_ml INTEGER NOT NULL DEFAULT 0,
  total_sleep_minutes INTEGER NOT NULL DEFAULT 0,
  total_exercise_minutes INTEGER NOT NULL DEFAULT 0,
  missions_completed INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT fk_bodylog_daily_aggregates_user
    FOREIGN KEY (user_id)
    REFERENCES zook_users(id)
    ON DELETE CASCADE,

  CONSTRAINT uq_bodylog_daily_aggregates_user_date
    UNIQUE (user_id, date)
);

CREATE INDEX IF NOT EXISTS idx_bodylog_daily_aggregates_user_id ON bodylog_daily_aggregates(user_id);
CREATE INDEX IF NOT EXISTS idx_bodylog_daily_aggregates_date ON bodylog_daily_aggregates(date);
CREATE INDEX IF NOT EXISTS idx_bodylog_daily_aggregates_user_date ON bodylog_daily_aggregates(user_id, date);

COMMENT ON TABLE bodylog_daily_aggregates IS 'Daily activity aggregates for BodyLog users';
COMMENT ON COLUMN bodylog_daily_aggregates.missions_completed IS 'Number of missions completed on this date';
