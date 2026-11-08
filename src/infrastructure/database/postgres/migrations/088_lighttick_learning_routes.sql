CREATE TABLE IF NOT EXISTS zook_lighttick_learning_routes (
 app_id TEXT NOT NULL CHECK(app_id='lighttick'), user_id TEXT NOT NULL, id TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision>0), payload JSONB NOT NULL CHECK(jsonb_typeof(payload)='object'),
 PRIMARY KEY(app_id,user_id,id)
);
CREATE TABLE IF NOT EXISTS zook_lighttick_learning_route_versions (
 app_id TEXT NOT NULL, user_id TEXT NOT NULL, route_id TEXT NOT NULL, version INTEGER NOT NULL CHECK(version>0),
 payload JSONB NOT NULL CHECK(jsonb_typeof(payload)='object'), PRIMARY KEY(app_id,user_id,route_id,version),
 FOREIGN KEY(app_id,user_id,route_id) REFERENCES zook_lighttick_learning_routes(app_id,user_id,id)
);
CREATE TABLE IF NOT EXISTS zook_lighttick_learning_route_lessons (
 app_id TEXT NOT NULL, user_id TEXT NOT NULL, route_id TEXT NOT NULL, number INTEGER NOT NULL CHECK(number>0),
 lesson_id TEXT NOT NULL, payload JSONB NOT NULL CHECK(jsonb_typeof(payload)='object'),
 PRIMARY KEY(app_id,user_id,route_id,number), UNIQUE(app_id,user_id,lesson_id),
 FOREIGN KEY(app_id,user_id,route_id) REFERENCES zook_lighttick_learning_routes(app_id,user_id,id),
 FOREIGN KEY(app_id,user_id,lesson_id) REFERENCES zook_lighttick_native_lessons(app_id,user_id,id)
);
