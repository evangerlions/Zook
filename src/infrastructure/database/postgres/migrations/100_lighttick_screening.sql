CREATE TABLE IF NOT EXISTS zook_lighttick_screen_definitions (
 app_id TEXT NOT NULL CHECK(app_id='lighttick'),user_id TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('rules','templates')),id TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 100),payload JSONB NOT NULL CHECK(jsonb_typeof(payload)='object'),PRIMARY KEY(app_id,user_id,kind,id),
 CHECK(payload->>'id' IS NOT DISTINCT FROM id),CHECK(payload->>'kind' IS NOT DISTINCT FROM kind),CHECK((payload->>'revision')::integer IS NOT DISTINCT FROM revision)
);
CREATE TABLE IF NOT EXISTS zook_lighttick_screen_versions (
 app_id TEXT NOT NULL CHECK(app_id='lighttick'),user_id TEXT NOT NULL,kind TEXT NOT NULL,id TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 100),payload JSONB NOT NULL CHECK(jsonb_typeof(payload)='object'),PRIMARY KEY(app_id,user_id,kind,id,revision),
 FOREIGN KEY(app_id,user_id,kind,id) REFERENCES zook_lighttick_screen_definitions(app_id,user_id,kind,id),
 CHECK(payload->>'id' IS NOT DISTINCT FROM id),CHECK(payload->>'kind' IS NOT DISTINCT FROM kind),CHECK((payload->>'revision')::integer IS NOT DISTINCT FROM revision)
);
CREATE TABLE IF NOT EXISTS zook_lighttick_screen_work (
 app_id TEXT NOT NULL CHECK(app_id='lighttick'),user_id TEXT NOT NULL,id TEXT NOT NULL,revision INTEGER NOT NULL CHECK(revision>0),
 status TEXT NOT NULL CHECK(status IN ('queued','running','succeeded','failed','cancelled')),lease_until TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL,
 payload JSONB NOT NULL CHECK(jsonb_typeof(payload)='object'),PRIMARY KEY(app_id,user_id,id),
 CHECK(payload->>'id' IS NOT DISTINCT FROM id),CHECK(payload->>'status' IS NOT DISTINCT FROM status),CHECK((payload->>'revision')::integer IS NOT DISTINCT FROM revision)
);
CREATE INDEX IF NOT EXISTS lighttick_screen_recovery ON zook_lighttick_screen_work(status,lease_until,created_at);
