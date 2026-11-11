CREATE TABLE IF NOT EXISTS zook_lighttick_reading_sources (
 app_id TEXT NOT NULL CHECK(app_id='lighttick'),user_id TEXT NOT NULL,id TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision>0),payload JSONB NOT NULL CHECK(jsonb_typeof(payload)='object'),PRIMARY KEY(app_id,user_id,id)
);
CREATE TABLE IF NOT EXISTS zook_lighttick_reading_source_versions (
 app_id TEXT NOT NULL CHECK(app_id='lighttick'),user_id TEXT NOT NULL,id TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision>0),payload JSONB NOT NULL,PRIMARY KEY(app_id,user_id,id,revision),
 FOREIGN KEY(app_id,user_id,id) REFERENCES zook_lighttick_reading_sources(app_id,user_id,id)
);
CREATE TABLE IF NOT EXISTS zook_lighttick_reading_work (
 app_id TEXT NOT NULL CHECK(app_id='lighttick'),user_id TEXT NOT NULL,id TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision>0),payload JSONB NOT NULL CHECK(jsonb_typeof(payload)='object'),PRIMARY KEY(app_id,user_id,id)
);
CREATE INDEX IF NOT EXISTS lighttick_reading_work_recovery ON zook_lighttick_reading_work((payload->>'status'),(payload->>'lease_until'));
