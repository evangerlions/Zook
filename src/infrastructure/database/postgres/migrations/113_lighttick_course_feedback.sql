-- Private feedback is versioned independently from explicit lesson completion.
CREATE TABLE IF NOT EXISTS zook_lighttick_course_feedback (
 app_id TEXT NOT NULL CHECK(app_id='lighttick'),user_id TEXT NOT NULL,collection_id TEXT NOT NULL,
 lesson_id TEXT NOT NULL,content_version TEXT NOT NULL,revision INTEGER NOT NULL CHECK(revision>0),data JSONB NOT NULL,
 PRIMARY KEY(app_id,user_id,collection_id,lesson_id,content_version),
 CHECK(jsonb_typeof(data)='object' AND data->>'lesson_id'=lesson_id AND data->>'content_version'=content_version AND (data->>'revision')::int=revision)
);
CREATE INDEX IF NOT EXISTS lighttick_course_summary_history ON zook_lighttick_learning_work(app_id,user_id,(payload->>'routeId'),id) WHERE payload->>'kind'='course_summary';
