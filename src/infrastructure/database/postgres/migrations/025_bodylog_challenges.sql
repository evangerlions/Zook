CREATE TABLE IF NOT EXISTS zook_bodylog_challenges (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL,
  creator_user_id TEXT NOT NULL,
  theme_key TEXT NOT NULL,
  timezone TEXT NOT NULL,
  status TEXT NOT NULL,
  start_date DATE,
  end_date DATE,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS zook_bodylog_challenge_members (
  app_id TEXT NOT NULL,
  challenge_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL,
  completed_dates JSONB NOT NULL DEFAULT '[]'::jsonb,
  joined_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (challenge_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_bodylog_challenge_member_user
  ON zook_bodylog_challenge_members (app_id, user_id, status);
