CREATE TABLE IF NOT EXISTS zook_bodylog_weekly_goal_snapshots (
  app_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  season_label TEXT NOT NULL,
  timezone TEXT NOT NULL,
  snapshot JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (app_id, user_id, season_label)
);

CREATE TABLE IF NOT EXISTS zook_bodylog_daily_aggregates (
  app_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  season_label TEXT NOT NULL,
  aggregate_date DATE NOT NULL,
  completed_habit_ids JSONB NOT NULL,
  accepted_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (app_id, user_id, season_label, aggregate_date)
);

CREATE TABLE IF NOT EXISTS zook_bodylog_leaderboard_entries (
  app_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  season_label TEXT NOT NULL,
  score INTEGER NOT NULL CHECK (score BETWEEN 0 AND 100),
  completion_score INTEGER NOT NULL,
  consistency_score INTEGER NOT NULL,
  effective_days INTEGER NOT NULL,
  completed_instances INTEGER NOT NULL,
  eligible_public BOOLEAN NOT NULL,
  reached_at TIMESTAMPTZ NOT NULL,
  opted_in BOOLEAN NOT NULL DEFAULT FALSE,
  updated_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (app_id, user_id, season_label)
);

CREATE INDEX IF NOT EXISTS idx_bodylog_leaderboard_rank
  ON zook_bodylog_leaderboard_entries
  (app_id, season_label, opted_in, eligible_public, score DESC);
