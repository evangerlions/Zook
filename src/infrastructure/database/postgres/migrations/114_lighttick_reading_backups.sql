-- Temporary immutable byte snapshots; owner deletion removes both artifacts.
CREATE TABLE IF NOT EXISTS zook_lighttick_reading_backups (
 app_id TEXT NOT NULL CHECK(app_id='lighttick'),user_id TEXT NOT NULL,id TEXT NOT NULL,
 expires_at TIMESTAMPTZ NOT NULL,payload JSONB CHECK(payload IS NULL OR jsonb_typeof(payload)='object'),
 PRIMARY KEY(app_id,user_id,id)
);
CREATE TABLE IF NOT EXISTS zook_lighttick_reading_backup_parts (
 app_id TEXT NOT NULL CHECK(app_id='lighttick'),user_id TEXT NOT NULL,backup_id TEXT NOT NULL,
 part_index INTEGER NOT NULL CHECK(part_index BETWEEN 0 AND 255),payload JSONB NOT NULL CHECK(jsonb_typeof(payload)='object'),
 PRIMARY KEY(app_id,user_id,backup_id,part_index),
 FOREIGN KEY(app_id,user_id,backup_id) REFERENCES zook_lighttick_reading_backups(app_id,user_id,id) ON DELETE CASCADE
);
