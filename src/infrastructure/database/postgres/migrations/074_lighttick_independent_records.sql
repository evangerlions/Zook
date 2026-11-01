-- Independent personal records. No dependency on goal/plan/task or legacy Grow owners.
CREATE TABLE IF NOT EXISTS zook_lighttick_records (
 app_id TEXT NOT NULL CHECK (app_id='lighttick'), user_id TEXT NOT NULL, id TEXT NOT NULL,
 payload JSONB NOT NULL, record_date DATE NOT NULL, version INTEGER NOT NULL CHECK(version>0), updated_at TIMESTAMPTZ NOT NULL,
 PRIMARY KEY(app_id,user_id,id)
);
CREATE INDEX IF NOT EXISTS zook_lighttick_records_owner_date ON zook_lighttick_records(app_id,user_id,record_date DESC,id DESC);
CREATE TABLE IF NOT EXISTS zook_lighttick_record_versions (
 app_id TEXT NOT NULL, user_id TEXT NOT NULL, record_id TEXT NOT NULL, version INTEGER NOT NULL CHECK(version>0), payload JSONB NOT NULL,
 PRIMARY KEY(app_id,user_id,record_id,version),
 FOREIGN KEY(app_id,user_id,record_id) REFERENCES zook_lighttick_records(app_id,user_id,id) ON DELETE CASCADE
);
