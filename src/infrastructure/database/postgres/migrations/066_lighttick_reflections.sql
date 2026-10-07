-- Additive journal storage. Rolling back the app preserves user-authored reflections.
CREATE TABLE IF NOT EXISTS zook_lighttick_reflections (
 id TEXT PRIMARY KEY, app_id TEXT NOT NULL CHECK(app_id='lighttick'), user_id TEXT NOT NULL,
 goal_id TEXT NOT NULL, plan_id TEXT, period_start DATE NOT NULL, period_end DATE NOT NULL,
 content TEXT NOT NULL CHECK(length(content) BETWEEN 1 AND 4000),
 next_action TEXT NOT NULL DEFAULT '' CHECK(length(next_action)<=1000),
 version INTEGER NOT NULL DEFAULT 1 CHECK(version>0),
 created_at TIMESTAMPTZ NOT NULL, updated_at TIMESTAMPTZ NOT NULL,
 CHECK(period_end>=period_start)
);
CREATE INDEX IF NOT EXISTS zook_lighttick_reflections_owner_goal_idx
 ON zook_lighttick_reflections(app_id,user_id,goal_id,updated_at DESC);
