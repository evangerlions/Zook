-- Multiple historical plans are valid; only one active plan per user is allowed.
ALTER TABLE bodylog_seven_day_plans DROP CONSTRAINT IF EXISTS uq_bodylog_seven_day_plans_user_active;
CREATE UNIQUE INDEX IF NOT EXISTS uq_bodylog_active_growth_plan ON bodylog_seven_day_plans (user_id) WHERE status = 'active';
ALTER TABLE bodylog_seven_day_plans DROP CONSTRAINT IF EXISTS bodylog_seven_day_plans_status_check;
ALTER TABLE bodylog_seven_day_plans ADD CONSTRAINT bodylog_seven_day_plans_status_check CHECK (status IN ('active', 'completed', 'cancelled', 'abandoned'));
UPDATE bodylog_seven_day_plans SET app_id = 'bodylog' WHERE app_id IS NULL;
UPDATE bodylog_seven_day_plans SET start_date = enrolled_at WHERE start_date IS NULL;
UPDATE bodylog_seven_day_plans SET end_date = start_date + INTERVAL '7 days' WHERE end_date IS NULL;
ALTER TABLE bodylog_seven_day_plans ALTER COLUMN app_id SET DEFAULT 'bodylog';
