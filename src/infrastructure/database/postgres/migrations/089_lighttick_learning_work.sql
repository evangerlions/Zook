CREATE TABLE IF NOT EXISTS zook_lighttick_learning_work (
 app_id TEXT NOT NULL CHECK(app_id='lighttick'),user_id TEXT NOT NULL,id TEXT NOT NULL,revision INTEGER NOT NULL CHECK(revision>0),
 status TEXT NOT NULL CHECK(status IN ('queued','running','succeeded','failed','cancelled')),lease_until TIMESTAMPTZ,
 created_at TIMESTAMPTZ NOT NULL,payload JSONB NOT NULL CHECK(jsonb_typeof(payload)='object'),PRIMARY KEY(app_id,user_id,id)
);
CREATE INDEX IF NOT EXISTS lighttick_learning_work_recovery ON zook_lighttick_learning_work(status,lease_until,created_at);
CREATE INDEX IF NOT EXISTS lighttick_learning_work_budget ON zook_lighttick_learning_work(app_id,user_id,created_at DESC);
