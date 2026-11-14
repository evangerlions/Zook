-- Frozen account statistics and durable AI task receipts. Application rollback preserves reports.
CREATE TABLE IF NOT EXISTS zook_lighttick_account_reports (
 app_id TEXT NOT NULL CHECK(app_id='lighttick'),user_id TEXT NOT NULL,id TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision>0),
 status TEXT NOT NULL CHECK(status IN ('queued','running','ready','failed','cancelled','interrupted','deleted')),
 lease_until TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL,data JSONB NOT NULL,
 PRIMARY KEY(app_id,user_id,id),
 CHECK(jsonb_typeof(data)='object' AND data->>'id'=id AND data->>'status'=status AND (data->>'revision')::int=revision)
);
CREATE INDEX IF NOT EXISTS zook_lighttick_account_reports_history_idx ON zook_lighttick_account_reports(app_id,user_id,created_at DESC,id) WHERE status<>'deleted';
CREATE INDEX IF NOT EXISTS zook_lighttick_account_reports_recovery_idx ON zook_lighttick_account_reports(status,lease_until) WHERE status IN ('queued','running');
