-- Words have their own revision, provenance and review schedule, independent of article read status.
CREATE TABLE IF NOT EXISTS zook_lighttick_reading_vocabulary (
 app_id TEXT NOT NULL CHECK(app_id='lighttick'), user_id TEXT NOT NULL, id TEXT NOT NULL,
 payload JSONB CHECK(payload IS NULL OR jsonb_typeof(payload)='object'),
 PRIMARY KEY(app_id,user_id,id)
);
CREATE TABLE IF NOT EXISTS zook_lighttick_reading_vocabulary_reviews (
 app_id TEXT NOT NULL CHECK(app_id='lighttick'), user_id TEXT NOT NULL, id TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision>0), payload JSONB NOT NULL CHECK(jsonb_typeof(payload)='object'),
 PRIMARY KEY(app_id,user_id,id,revision),
 FOREIGN KEY(app_id,user_id,id) REFERENCES zook_lighttick_reading_vocabulary(app_id,user_id,id)
);

CREATE INDEX IF NOT EXISTS idx_lighttick_vocabulary_provenance
 ON zook_lighttick_reading_vocabulary(app_id,user_id,(payload->>'article_id'),(payload->>'normalized')) WHERE payload IS NOT NULL;
