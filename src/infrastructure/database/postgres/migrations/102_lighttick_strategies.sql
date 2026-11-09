CREATE TABLE IF NOT EXISTS zook_lighttick_strategy_definitions (
 app_id TEXT NOT NULL CHECK(app_id='lighttick'),user_id TEXT NOT NULL,id TEXT NOT NULL,revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 100),payload JSONB NOT NULL,
 PRIMARY KEY(app_id,user_id,id),CHECK(payload->>'id' IS NOT DISTINCT FROM id),CHECK((payload->>'revision')::integer IS NOT DISTINCT FROM revision)
);
CREATE TABLE IF NOT EXISTS zook_lighttick_strategy_versions (
 app_id TEXT NOT NULL CHECK(app_id='lighttick'),user_id TEXT NOT NULL,id TEXT NOT NULL,revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 100),payload JSONB NOT NULL,
 PRIMARY KEY(app_id,user_id,id,revision),FOREIGN KEY(app_id,user_id,id) REFERENCES zook_lighttick_strategy_definitions(app_id,user_id,id),
 CHECK(payload->>'id' IS NOT DISTINCT FROM id),CHECK((payload->>'revision')::integer IS NOT DISTINCT FROM revision)
);
CREATE TABLE IF NOT EXISTS zook_lighttick_backtest_work (
 app_id TEXT NOT NULL CHECK(app_id='lighttick'),user_id TEXT NOT NULL,id TEXT NOT NULL,revision INTEGER NOT NULL CHECK(revision>0),
 status TEXT NOT NULL CHECK(status IN ('queued','running','succeeded','failed','cancelled')),lease_until TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL,payload JSONB NOT NULL,
 PRIMARY KEY(app_id,user_id,id),CHECK(payload->>'id' IS NOT DISTINCT FROM id),CHECK(payload->>'status' IS NOT DISTINCT FROM status),CHECK((payload->>'revision')::integer IS NOT DISTINCT FROM revision)
);
CREATE INDEX IF NOT EXISTS lighttick_backtest_recover ON zook_lighttick_backtest_work(status,lease_until,created_at);
