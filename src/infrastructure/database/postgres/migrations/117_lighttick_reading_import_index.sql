-- Derived lookup only: article payload and immutable versions remain authoritative.
CREATE TABLE IF NOT EXISTS zook_lighttick_reading_import_index (
 app_id TEXT NOT NULL CHECK(app_id='lighttick'), user_id TEXT NOT NULL, id TEXT NOT NULL,
 url_key TEXT, content_version TEXT NOT NULL,
 PRIMARY KEY(app_id,user_id,id),
 FOREIGN KEY(app_id,user_id,id) REFERENCES zook_lighttick_reading_articles(app_id,user_id,id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS lighttick_reading_import_url ON zook_lighttick_reading_import_index(app_id,user_id,url_key) WHERE url_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS lighttick_reading_import_content ON zook_lighttick_reading_import_index(app_id,user_id,content_version);
