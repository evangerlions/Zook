-- Independent user-described application records. Archive keeps review history.
CREATE TABLE IF NOT EXISTS zook_lighttick_behavior_applications (
 app_id TEXT NOT NULL CHECK(app_id='lighttick'), user_id TEXT NOT NULL,id TEXT NOT NULL,
 version INTEGER NOT NULL CHECK(version>0),business_date DATE NOT NULL,archived BOOLEAN NOT NULL,created_at TIMESTAMPTZ NOT NULL,data JSONB NOT NULL,
 PRIMARY KEY(app_id,user_id,id),
 CHECK(data->>'id'=id AND (data->>'version')::integer=version AND (data->>'archived')::boolean=archived AND (data->>'effectiveness')::integer BETWEEN 0 AND 5)
);
CREATE INDEX IF NOT EXISTS zook_lighttick_behavior_history_idx ON zook_lighttick_behavior_applications(app_id,user_id,archived,business_date DESC,created_at DESC,id);
CREATE INDEX IF NOT EXISTS zook_lighttick_behavior_concept_idx ON zook_lighttick_behavior_applications(app_id,user_id,(data->>'concept')) WHERE NOT archived;
CREATE INDEX IF NOT EXISTS zook_lighttick_report_topic_idx ON zook_lighttick_account_reports(app_id,user_id,(COALESCE(data->>'topic','account')),created_at DESC,id) WHERE status<>'deleted';
