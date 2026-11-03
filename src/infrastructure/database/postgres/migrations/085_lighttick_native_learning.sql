-- Canonical learning data is separate from legacy exchange mirrors.
CREATE TABLE IF NOT EXISTS zook_lighttick_learning_authorities (
 app_id TEXT NOT NULL CHECK(app_id='lighttick'), user_id TEXT NOT NULL, module TEXT NOT NULL CHECK(module='learning'),
 phase TEXT NOT NULL CHECK(phase IN ('legacy','frozen','imported','verified','zook')), epoch INTEGER NOT NULL CHECK(epoch>=0),
 revision INTEGER NOT NULL CHECK(revision>0), manifest_hash TEXT, source_binding TEXT, updated_at TIMESTAMPTZ NOT NULL,
 PRIMARY KEY(app_id,user_id,module)
);
CREATE TABLE IF NOT EXISTS zook_lighttick_learning_collections (
 app_id TEXT NOT NULL CHECK(app_id='lighttick'), user_id TEXT NOT NULL, id TEXT NOT NULL, title TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision>0), archived BOOLEAN NOT NULL DEFAULT FALSE, updated_at TIMESTAMPTZ NOT NULL,
 PRIMARY KEY(app_id,user_id,id)
);
CREATE TABLE IF NOT EXISTS zook_lighttick_native_lessons (
 app_id TEXT NOT NULL CHECK(app_id='lighttick'), user_id TEXT NOT NULL, id TEXT NOT NULL, collection_id TEXT NOT NULL,
 number INTEGER NOT NULL CHECK(number>0), title TEXT NOT NULL, revision INTEGER NOT NULL CHECK(revision>0),
 published_version TEXT, archived BOOLEAN NOT NULL DEFAULT FALSE, updated_at TIMESTAMPTZ NOT NULL,
 PRIMARY KEY(app_id,user_id,id), UNIQUE(app_id,user_id,collection_id,number),
 FOREIGN KEY(app_id,user_id,collection_id) REFERENCES zook_lighttick_learning_collections(app_id,user_id,id)
);
CREATE TABLE IF NOT EXISTS zook_lighttick_lesson_publications (
 app_id TEXT NOT NULL CHECK(app_id='lighttick'), user_id TEXT NOT NULL, lesson_id TEXT NOT NULL,
 content_version TEXT NOT NULL CHECK(content_version ~ '^[a-f0-9]{64}$'), content TEXT NOT NULL, "references" TEXT NOT NULL,
 source_url TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL, PRIMARY KEY(app_id,user_id,lesson_id,content_version),
 FOREIGN KEY(app_id,user_id,lesson_id) REFERENCES zook_lighttick_native_lessons(app_id,user_id,id)
);
CREATE TABLE IF NOT EXISTS zook_lighttick_native_learning_private (
 app_id TEXT NOT NULL CHECK(app_id='lighttick'),user_id TEXT NOT NULL,lesson_id TEXT NOT NULL,content_version TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision>0),notes_revision INTEGER NOT NULL CHECK(notes_revision>=0),
 position_revision INTEGER NOT NULL CHECK(position_revision>=0),completion_revision INTEGER NOT NULL CHECK(completion_revision>=0),
 notes TEXT NOT NULL, answers JSONB NOT NULL CHECK(jsonb_typeof(answers)='array'), position INTEGER NOT NULL CHECK(position BETWEEN 0 AND 100000),
 completed BOOLEAN NOT NULL,completed_at TIMESTAMPTZ,updated_at TIMESTAMPTZ NOT NULL,
 PRIMARY KEY(app_id,user_id,lesson_id,content_version),
 FOREIGN KEY(app_id,user_id,lesson_id,content_version) REFERENCES zook_lighttick_lesson_publications(app_id,user_id,lesson_id,content_version)
);
CREATE TABLE IF NOT EXISTS zook_lighttick_native_learning_history (
 app_id TEXT NOT NULL CHECK(app_id='lighttick'),user_id TEXT NOT NULL,id TEXT NOT NULL,lesson_id TEXT NOT NULL,content_version TEXT NOT NULL,
 component TEXT NOT NULL CHECK(component IN ('initial','notes','position','completion','import')),revision INTEGER NOT NULL CHECK(revision>0),
 state JSONB NOT NULL,created_at TIMESTAMPTZ NOT NULL,PRIMARY KEY(app_id,user_id,id),
 UNIQUE(app_id,user_id,lesson_id,content_version,revision),
 FOREIGN KEY(app_id,user_id,lesson_id,content_version) REFERENCES zook_lighttick_lesson_publications(app_id,user_id,lesson_id,content_version)
);
CREATE INDEX IF NOT EXISTS zook_lighttick_learning_history_page ON zook_lighttick_native_learning_history(app_id,user_id,lesson_id,content_version,id);
