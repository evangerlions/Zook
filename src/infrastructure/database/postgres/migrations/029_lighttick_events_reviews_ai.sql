CREATE TABLE IF NOT EXISTS zook_lighttick_execution_events (
  id TEXT PRIMARY KEY, app_id TEXT NOT NULL, user_id TEXT NOT NULL,
  aggregate_type TEXT NOT NULL, aggregate_id TEXT NOT NULL, event_type TEXT NOT NULL,
  aggregate_version INTEGER NOT NULL CHECK (aggregate_version > 0),
  payload JSONB NOT NULL DEFAULT '{}'::jsonb, occurred_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS zook_lighttick_events_aggregate_version_uidx
  ON zook_lighttick_execution_events (app_id, user_id, aggregate_type, aggregate_id, aggregate_version);
CREATE INDEX IF NOT EXISTS zook_lighttick_events_owner_time_idx
  ON zook_lighttick_execution_events (app_id, user_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS zook_lighttick_reviews (
  id TEXT PRIMARY KEY, app_id TEXT NOT NULL, user_id TEXT NOT NULL, goal_id TEXT NOT NULL,
  period TEXT NOT NULL, status TEXT NOT NULL, period_start DATE NOT NULL, period_end DATE NOT NULL,
  facts JSONB NOT NULL DEFAULT '{}'::jsonb, output JSONB NOT NULL DEFAULT '{}'::jsonb,
  data_sufficiency TEXT NOT NULL, version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (period_end >= period_start)
);
CREATE INDEX IF NOT EXISTS zook_lighttick_reviews_owner_period_idx
  ON zook_lighttick_reviews (app_id, user_id, period_start DESC);

CREATE TABLE IF NOT EXISTS zook_lighttick_change_proposals (
  id TEXT PRIMARY KEY, app_id TEXT NOT NULL, user_id TEXT NOT NULL, plan_id TEXT NOT NULL,
  base_plan_version INTEGER NOT NULL CHECK (base_plan_version > 0), status TEXT NOT NULL,
  reason TEXT NOT NULL, diff JSONB NOT NULL, impact JSONB NOT NULL DEFAULT '{}'::jsonb,
  expires_at TIMESTAMPTZ NOT NULL, decided_at TIMESTAMPTZ,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS zook_lighttick_proposals_owner_plan_idx
  ON zook_lighttick_change_proposals (app_id, user_id, plan_id, status, created_at DESC);

CREATE TABLE IF NOT EXISTS zook_lighttick_ai_runs (
  id TEXT PRIMARY KEY, app_id TEXT NOT NULL, user_id TEXT NOT NULL,
  kind TEXT NOT NULL, status TEXT NOT NULL, resource_id TEXT,
  scene_key TEXT NOT NULL, prompt_version TEXT NOT NULL, schema_version TEXT NOT NULL,
  provider TEXT, model TEXT, attempt_count INTEGER NOT NULL DEFAULT 0,
  input_context JSONB NOT NULL DEFAULT '{}'::jsonb, output JSONB,
  error_code TEXT, usage JSONB NOT NULL DEFAULT '{}'::jsonb,
  latency_ms INTEGER, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  started_at TIMESTAMPTZ, completed_at TIMESTAMPTZ, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS zook_lighttick_ai_runs_owner_status_idx
  ON zook_lighttick_ai_runs (app_id, user_id, status, created_at DESC);
