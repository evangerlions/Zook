-- Independent application/error/type facts, never task-only sync or a whole-owner form blob.
CREATE TABLE IF NOT EXISTS zook_lighttick_experience (
 app_id text NOT NULL,user_id text NOT NULL,kind text NOT NULL CHECK(kind IN ('application','error','error_type')),
 id text NOT NULL,revision integer NOT NULL CHECK(revision>0),payload jsonb NOT NULL,
 PRIMARY KEY(app_id,user_id,kind,id),CHECK(jsonb_typeof(payload)='object')
);
CREATE TABLE IF NOT EXISTS zook_lighttick_experience_versions (
 app_id text NOT NULL,user_id text NOT NULL,kind text NOT NULL,id text NOT NULL,
 revision integer NOT NULL CHECK(revision>0),payload jsonb NOT NULL,
 PRIMARY KEY(app_id,user_id,kind,id,revision),
 FOREIGN KEY(app_id,user_id,kind,id) REFERENCES zook_lighttick_experience(app_id,user_id,kind,id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS zook_lighttick_experience_tombstones (
 app_id text NOT NULL,user_id text NOT NULL,kind text NOT NULL,id text NOT NULL,payload jsonb NOT NULL,
 PRIMARY KEY(app_id,user_id,kind,id)
);
CREATE INDEX IF NOT EXISTS lighttick_experience_date ON zook_lighttick_experience(app_id,user_id,kind,(payload->'data'->>'date') DESC,id DESC);
CREATE INDEX IF NOT EXISTS lighttick_experience_module ON zook_lighttick_experience(app_id,user_id,kind,(payload->'data'->>'module_id'));
CREATE INDEX IF NOT EXISTS lighttick_experience_error_type ON zook_lighttick_experience(app_id,user_id,kind,(payload->'data'->>'error_type'));
CREATE INDEX IF NOT EXISTS lighttick_experience_related ON zook_lighttick_experience(app_id,user_id,kind,(payload->'data'->>'related_error_id'));
CREATE INDEX IF NOT EXISTS lighttick_experience_type_ref ON zook_lighttick_experience(app_id,user_id,kind,(payload->'data'->>'type_id'));
