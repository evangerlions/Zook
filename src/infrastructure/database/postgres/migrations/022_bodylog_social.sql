CREATE TABLE IF NOT EXISTS zook_bodylog_friend_requests (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL,
  sender_user_id TEXT NOT NULL,
  recipient_user_id TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_bodylog_friend_requests_users
  ON zook_bodylog_friend_requests (app_id, sender_user_id, recipient_user_id, status);

CREATE TABLE IF NOT EXISTS zook_bodylog_friendships (
  app_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  friend_user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (app_id, user_id, friend_user_id),
  CHECK (user_id <> friend_user_id)
);

CREATE TABLE IF NOT EXISTS zook_bodylog_blocks (
  app_id TEXT NOT NULL,
  blocker_user_id TEXT NOT NULL,
  blocked_user_id TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (app_id, blocker_user_id, blocked_user_id),
  CHECK (blocker_user_id <> blocked_user_id)
);

CREATE TABLE IF NOT EXISTS zook_bodylog_reports (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL,
  reporter_user_id TEXT NOT NULL,
  reported_user_id TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_bodylog_reports_reporter
  ON zook_bodylog_reports (app_id, reporter_user_id, created_at DESC);
