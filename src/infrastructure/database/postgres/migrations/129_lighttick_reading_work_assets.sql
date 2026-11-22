CREATE TABLE IF NOT EXISTS zook_lighttick_reading_work_assets (
 app_id TEXT NOT NULL CHECK(app_id='lighttick'),user_id TEXT NOT NULL,work_id TEXT NOT NULL,id TEXT NOT NULL,
 payload JSONB NOT NULL CHECK(jsonb_typeof(payload)='object'),PRIMARY KEY(app_id,user_id,work_id,id),
 FOREIGN KEY(app_id,user_id,work_id) REFERENCES zook_lighttick_reading_work(app_id,user_id,id)
);
