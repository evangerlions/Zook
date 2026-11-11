CREATE TABLE IF NOT EXISTS zook_lighttick_reading_schedule_days (
 app_id TEXT NOT NULL CHECK(app_id='lighttick'),user_id TEXT NOT NULL,date TEXT NOT NULL CHECK(date ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$'),
 revision INTEGER NOT NULL CHECK(revision>0),payload JSONB NOT NULL CHECK(jsonb_typeof(payload)='object'),PRIMARY KEY(app_id,user_id,date)
);
CREATE INDEX IF NOT EXISTS lighttick_reading_enabled_schedule ON zook_lighttick_reading_preferences(app_id,user_id) WHERE (payload->'value'->>'enabled')='true';
CREATE INDEX IF NOT EXISTS lighttick_reading_schedule_due ON zook_lighttick_reading_schedule_days(date,(payload->>'phase'),(payload->>'next_at'));

