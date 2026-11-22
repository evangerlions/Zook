-- Standalone, owner-scoped self-reported errors; related IDs do not complete tasks.
CREATE TABLE IF NOT EXISTS zook_lighttick_error_categories (
 app_id TEXT NOT NULL CHECK(app_id='lighttick'),user_id TEXT NOT NULL,id TEXT NOT NULL,version INTEGER NOT NULL CHECK(version>0),normalized_name TEXT NOT NULL,data JSONB NOT NULL,
 PRIMARY KEY(app_id,user_id,id),UNIQUE(app_id,user_id,normalized_name),CHECK(jsonb_typeof(data)='object' AND data->>'id'=id AND (data->>'version')::int=version)
);
CREATE TABLE IF NOT EXISTS zook_lighttick_error_records (
 app_id TEXT NOT NULL CHECK(app_id='lighttick'),user_id TEXT NOT NULL,id TEXT NOT NULL,version INTEGER NOT NULL CHECK(version>0),business_date DATE NOT NULL,archived BOOLEAN NOT NULL,created_at TIMESTAMPTZ NOT NULL,data JSONB NOT NULL,
 PRIMARY KEY(app_id,user_id,id),CHECK(jsonb_typeof(data)='object' AND data->>'id'=id AND (data->>'version')::int=version AND (data->>'archived')::boolean=archived AND (data->>'severity')::int BETWEEN 0 AND 5)
);
CREATE INDEX IF NOT EXISTS lighttick_error_list ON zook_lighttick_error_records(app_id,user_id,archived,business_date DESC,created_at DESC,id);
CREATE INDEX IF NOT EXISTS lighttick_error_related ON zook_lighttick_error_records(app_id,user_id,(data->>'related_error_id'),id);
CREATE INDEX IF NOT EXISTS lighttick_error_category ON zook_lighttick_error_records(app_id,user_id,(data->>'category_id'));
