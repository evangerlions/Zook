CREATE TABLE IF NOT EXISTS zook_lighttick_reading_preferences (
 app_id TEXT NOT NULL CHECK(app_id='lighttick'),user_id TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision>0),payload JSONB NOT NULL CHECK(jsonb_typeof(payload)='object'),PRIMARY KEY(app_id,user_id)
);
CREATE TABLE IF NOT EXISTS zook_lighttick_reading_preferences_versions (
 app_id TEXT NOT NULL CHECK(app_id='lighttick'),user_id TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision>0),payload JSONB NOT NULL,
 PRIMARY KEY(app_id,user_id,revision),FOREIGN KEY(app_id,user_id) REFERENCES zook_lighttick_reading_preferences(app_id,user_id)
);
