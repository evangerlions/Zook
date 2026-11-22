CREATE TABLE IF NOT EXISTS zook_lighttick_weekly_planning_budgets (
  app_id text NOT NULL,
  user_id text NOT NULL,
  weekly_available_minutes integer CHECK (weekly_available_minutes BETWEEN 0 AND 10080),
  plan_percent integer NOT NULL CHECK (plan_percent BETWEEN 1 AND 100),
  version integer NOT NULL CHECK (version > 0),
  PRIMARY KEY (app_id, user_id)
);
