CREATE TABLE IF NOT EXISTS zook_lighttick_tutor_observations (
  app_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  lesson_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  payload JSONB NOT NULL,
  PRIMARY KEY (app_id, user_id, lesson_id)
);
