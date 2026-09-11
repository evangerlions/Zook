-- Migration: 032_bodylog_seven_day_plans
-- Description: Create table for 7-day plan enrollments
-- Date: 2026-08-27

CREATE TABLE IF NOT EXISTS bodylog_seven_day_plans (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id VARCHAR(50) NOT NULL,
  user_id VARCHAR(255) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'completed', 'abandoned')),
  enrolled_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  abandoned_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT fk_bodylog_seven_day_plans_user
    FOREIGN KEY (user_id)
    REFERENCES zook_users(id)
    ON DELETE CASCADE,

  CONSTRAINT uq_bodylog_seven_day_plans_user_active
    UNIQUE (user_id, status)
);

CREATE INDEX IF NOT EXISTS idx_bodylog_seven_day_plans_user_id ON bodylog_seven_day_plans(user_id);
CREATE INDEX IF NOT EXISTS idx_bodylog_seven_day_plans_status ON bodylog_seven_day_plans(status);
CREATE INDEX IF NOT EXISTS idx_bodylog_seven_day_plans_enrolled_at ON bodylog_seven_day_plans(enrolled_at);

COMMENT ON TABLE bodylog_seven_day_plans IS '7-day plan enrollments for BodyLog users';
COMMENT ON COLUMN bodylog_seven_day_plans.status IS 'Plan status: active, completed, or abandoned';
