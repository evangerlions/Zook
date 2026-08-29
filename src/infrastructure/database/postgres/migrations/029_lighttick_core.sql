-- LightTick owner-scoped deterministic core. Every mutable aggregate uses an
-- integer version for compare-and-swap writes and is always queried by app/user.
CREATE TABLE IF NOT EXISTS zook_lighttick_profiles (
  app_id TEXT NOT NULL, user_id TEXT NOT NULL, timezone TEXT NOT NULL,
  locale TEXT NOT NULL, pace TEXT NOT NULL, onboarding_state TEXT NOT NULL,
  notification_preferences JSONB NOT NULL DEFAULT '{}'::jsonb,
  onboarding_draft JSONB NOT NULL DEFAULT '{}'::jsonb,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (app_id, user_id)
);

CREATE TABLE IF NOT EXISTS zook_lighttick_goals (
  id TEXT PRIMARY KEY, app_id TEXT NOT NULL, user_id TEXT NOT NULL,
  title TEXT NOT NULL, description TEXT, status TEXT NOT NULL,
  constraints JSONB NOT NULL DEFAULT '{}'::jsonb,
  target_date DATE, version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS zook_lighttick_goals_owner_status_idx
  ON zook_lighttick_goals (app_id, user_id, status, updated_at DESC);

CREATE TABLE IF NOT EXISTS zook_lighttick_plan_cycles (
  id TEXT PRIMARY KEY, app_id TEXT NOT NULL, user_id TEXT NOT NULL, goal_id TEXT NOT NULL,
  granularity TEXT NOT NULL, status TEXT NOT NULL, source TEXT NOT NULL,
  period_start DATE NOT NULL, period_end DATE NOT NULL, proposal JSONB NOT NULL DEFAULT '{}'::jsonb,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (period_end >= period_start)
);
CREATE INDEX IF NOT EXISTS zook_lighttick_plans_owner_goal_idx
  ON zook_lighttick_plan_cycles (app_id, user_id, goal_id, period_start DESC);

CREATE TABLE IF NOT EXISTS zook_lighttick_tasks (
  id TEXT PRIMARY KEY, app_id TEXT NOT NULL, user_id TEXT NOT NULL,
  goal_id TEXT NOT NULL, plan_id TEXT NOT NULL, title TEXT NOT NULL,
  status TEXT NOT NULL, priority INTEGER NOT NULL DEFAULT 0,
  estimated_minutes INTEGER NOT NULL CHECK (estimated_minutes > 0),
  scheduled_for TIMESTAMPTZ, started_at TIMESTAMPTZ, completed_at TIMESTAMPTZ,
  notes TEXT, version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS zook_lighttick_tasks_owner_schedule_idx
  ON zook_lighttick_tasks (app_id, user_id, scheduled_for, priority DESC);
CREATE INDEX IF NOT EXISTS zook_lighttick_tasks_owner_plan_idx
  ON zook_lighttick_tasks (app_id, user_id, plan_id, status);

CREATE TABLE IF NOT EXISTS zook_lighttick_task_steps (
  id TEXT PRIMARY KEY, app_id TEXT NOT NULL, user_id TEXT NOT NULL, task_id TEXT NOT NULL,
  title TEXT NOT NULL, position INTEGER NOT NULL CHECK (position >= 0),
  completed BOOLEAN NOT NULL DEFAULT FALSE, version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS zook_lighttick_task_steps_position_uidx
  ON zook_lighttick_task_steps (app_id, user_id, task_id, position);
