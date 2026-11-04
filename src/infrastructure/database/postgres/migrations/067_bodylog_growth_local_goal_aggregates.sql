ALTER TABLE bodylog_seven_day_plans
  ADD COLUMN IF NOT EXISTS time_zone VARCHAR(64) NOT NULL DEFAULT 'UTC';

-- Legacy active plans used client-confirmed steps/water/sleep missions. Close them
-- without deleting their history; users can enroll in the verifiable definition.
UPDATE bodylog_seven_day_plans
SET status = 'cancelled', end_date = NOW(), updated_at = NOW()
WHERE status = 'active'
  AND NOT EXISTS (
    SELECT 1 FROM bodylog_missions
    WHERE plan_id = bodylog_seven_day_plans.id AND type = 'localGoal'
  );

CREATE TABLE IF NOT EXISTS bodylog_growth_daily_aggregates (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id VARCHAR(50) NOT NULL DEFAULT 'bodylog',
  user_id VARCHAR(255) NOT NULL REFERENCES zook_users(id) ON DELETE CASCADE,
  local_date DATE NOT NULL,
  time_zone VARCHAR(64) NOT NULL,
  completed_goal_count INTEGER NOT NULL CHECK (completed_goal_count >= 0),
  eligible_goal_count INTEGER NOT NULL CHECK (eligible_goal_count >= completed_goal_count),
  definition_version INTEGER NOT NULL CHECK (definition_version > 0),
  event_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_bodylog_growth_daily_aggregate_user_date UNIQUE (app_id, user_id, local_date)
);

CREATE INDEX IF NOT EXISTS idx_bodylog_growth_daily_aggregate_date
  ON bodylog_growth_daily_aggregates (app_id, local_date);
