CREATE TABLE IF NOT EXISTS zook_bodylog_profiles (
  app_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  nickname TEXT NOT NULL,
  avatar_key TEXT NOT NULL,
  profile_completed BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (app_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_bodylog_profiles_nickname
  ON zook_bodylog_profiles (app_id, nickname);
