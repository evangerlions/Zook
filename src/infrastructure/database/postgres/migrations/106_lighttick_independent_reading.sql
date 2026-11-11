-- Independent article content and private reading history; no course authority changes.
CREATE TABLE IF NOT EXISTS zook_lighttick_reading_articles (
 app_id TEXT NOT NULL CHECK(app_id='lighttick'), user_id TEXT NOT NULL, id TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision>0), payload JSONB NOT NULL CHECK(jsonb_typeof(payload)='object'),
 PRIMARY KEY(app_id,user_id,id)
);
CREATE TABLE IF NOT EXISTS zook_lighttick_reading_versions (
 app_id TEXT NOT NULL CHECK(app_id='lighttick'), user_id TEXT NOT NULL, id TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision>0), payload JSONB NOT NULL CHECK(jsonb_typeof(payload)='object'),
 PRIMARY KEY(app_id,user_id,id,revision),
 FOREIGN KEY(app_id,user_id,id) REFERENCES zook_lighttick_reading_articles(app_id,user_id,id)
);
