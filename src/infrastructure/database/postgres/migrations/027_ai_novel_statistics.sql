CREATE TABLE IF NOT EXISTS zook_ai_novel_statistics_snapshots (
  app_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  total_works INTEGER NOT NULL DEFAULT 0,
  total_words INTEGER NOT NULL DEFAULT 0,
  total_chapters INTEGER NOT NULL DEFAULT 0,
  active_writing_days INTEGER NOT NULL DEFAULT 0,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (app_id, user_id)
);

CREATE TABLE IF NOT EXISTS zook_ai_novel_daily_statistics (
  app_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  date_key TEXT NOT NULL,
  words INTEGER NOT NULL DEFAULT 0,
  tokens INTEGER NOT NULL DEFAULT 0,
  active BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (app_id, user_id, date_key)
);

CREATE INDEX IF NOT EXISTS idx_zook_ai_novel_daily_stats_user_date
  ON zook_ai_novel_daily_statistics(app_id, user_id, date_key ASC);
