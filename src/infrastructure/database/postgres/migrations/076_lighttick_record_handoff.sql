CREATE TABLE IF NOT EXISTS zook_lighttick_record_tickets (
 hash TEXT PRIMARY KEY, app_id TEXT NOT NULL CHECK(app_id='lighttick'), user_id TEXT NOT NULL, payload JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS lighttick_record_tickets_owner ON zook_lighttick_record_tickets(app_id,user_id);
CREATE TABLE IF NOT EXISTS zook_lighttick_record_transfers (
 source_key TEXT PRIMARY KEY, app_id TEXT NOT NULL CHECK(app_id='lighttick'), user_id TEXT NOT NULL, payload JSONB NOT NULL,
 UNIQUE(app_id,user_id)
);
CREATE TABLE IF NOT EXISTS zook_lighttick_record_source_history (
 app_id TEXT NOT NULL, user_id TEXT NOT NULL, record_id TEXT NOT NULL, payload JSONB NOT NULL,
 PRIMARY KEY(app_id,user_id,record_id), FOREIGN KEY(app_id,user_id,record_id) REFERENCES zook_lighttick_records(app_id,user_id,id) ON DELETE CASCADE
);
