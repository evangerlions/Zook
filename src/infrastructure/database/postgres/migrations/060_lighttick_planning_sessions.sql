-- Additive: old applications ignore this table; rollback disables the entry point without dropping data.
CREATE TABLE IF NOT EXISTS zook_lighttick_planning_sessions (
  id TEXT PRIMARY KEY, app_id TEXT NOT NULL CHECK (app_id='lighttick'), user_id TEXT NOT NULL,
  goal_id TEXT NOT NULL, thread_id TEXT NOT NULL, payload JSONB NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL,
  UNIQUE (app_id,user_id,thread_id), CHECK (jsonb_typeof(payload)='object')
);
CREATE INDEX IF NOT EXISTS zook_lighttick_planning_owner_goal_idx
  ON zook_lighttick_planning_sessions (app_id,user_id,goal_id,updated_at DESC);
