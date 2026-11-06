CREATE TABLE IF NOT EXISTS zook_lighttick_research_ai (
 app_id TEXT NOT NULL CHECK(app_id='lighttick'),user_id TEXT NOT NULL,id TEXT NOT NULL,revision INTEGER NOT NULL CHECK(revision>0),
 status TEXT NOT NULL CHECK(status IN ('queued','running','succeeded','failed','cancelled')),lease_until TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL,payload JSONB NOT NULL,
 PRIMARY KEY(app_id,user_id,id),CHECK(payload->>'id' IS NOT DISTINCT FROM id),CHECK((payload->>'revision')::integer IS NOT DISTINCT FROM revision),CHECK(payload->>'status' IS NOT DISTINCT FROM status)
);
CREATE INDEX IF NOT EXISTS zook_lighttick_research_ai_recovery ON zook_lighttick_research_ai(status,lease_until,created_at);
