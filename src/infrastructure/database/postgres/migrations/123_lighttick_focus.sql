-- Focus/break clocks and explicitly confirmed records. Additive rollback retains user assets.
CREATE TABLE IF NOT EXISTS zook_lighttick_focus_preferences (
 app_id TEXT NOT NULL CHECK(app_id='lighttick'),user_id TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision>0),data JSONB NOT NULL,
 PRIMARY KEY(app_id,user_id),CHECK(jsonb_typeof(data)='object' AND (data->>'revision')::int=revision)
);
CREATE TABLE IF NOT EXISTS zook_lighttick_focus_sessions (
 app_id TEXT NOT NULL CHECK(app_id='lighttick'),user_id TEXT NOT NULL,id TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision>0),status TEXT NOT NULL CHECK(status IN ('running','paused','saved','discarded')),
 kind TEXT NOT NULL CHECK(kind IN ('focus','break')),business_date DATE NOT NULL,started_at TIMESTAMPTZ NOT NULL,data JSONB NOT NULL,
 PRIMARY KEY(app_id,user_id,id),
 CHECK(jsonb_typeof(data)='object' AND data->>'id'=id AND data->>'status'=status AND data->>'kind'=kind AND (data->>'revision')::int=revision),
 CHECK((data->>'planned_seconds')::int BETWEEN 60 AND CASE WHEN kind='focus' THEN 10800 ELSE 3600 END),
 CHECK((data->>'accumulated_ms')::bigint BETWEEN 0 AND (data->>'planned_seconds')::bigint*1000)
);
CREATE UNIQUE INDEX IF NOT EXISTS zook_lighttick_focus_one_active_idx ON zook_lighttick_focus_sessions(app_id,user_id) WHERE status IN ('running','paused');
CREATE INDEX IF NOT EXISTS zook_lighttick_focus_history_idx ON zook_lighttick_focus_sessions(app_id,user_id,started_at DESC,id);
CREATE INDEX IF NOT EXISTS zook_lighttick_focus_summary_idx ON zook_lighttick_focus_sessions(app_id,user_id,business_date) WHERE kind='focus' AND status='saved';
