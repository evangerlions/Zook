-- BodyLog Admin Indexes
-- Performance indexes for admin dashboard queries

-- The admin search index uses PostgreSQL's trigram operator class.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- User profiles: search by nickname and sort by created_at.
CREATE INDEX IF NOT EXISTS idx_bodylog_profiles_app_status_created
  ON zook_bodylog_profiles (app_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bodylog_profiles_nickname_trgm
  ON zook_bodylog_profiles USING gin (nickname gin_trgm_ops);

-- Reports currently have no status column; keep the list ordered by creation time.
CREATE INDEX IF NOT EXISTS idx_bodylog_reports_created
  ON zook_bodylog_reports (app_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bodylog_reports_reporter
  ON zook_bodylog_reports (reporter_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bodylog_reports_reported
  ON zook_bodylog_reports (reported_user_id, created_at DESC);

-- Blocks: filter by blocker/blocked user
CREATE INDEX IF NOT EXISTS idx_bodylog_blocks_blocker
  ON zook_bodylog_blocks (blocker_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bodylog_blocks_blocked
  ON zook_bodylog_blocks (blocked_user_id, created_at DESC);

-- Leaderboard entries: filter by season, sort by score
CREATE INDEX IF NOT EXISTS idx_bodylog_leaderboard_season_score
  ON zook_bodylog_leaderboard_entries (season_label, score DESC);

CREATE INDEX IF NOT EXISTS idx_bodylog_leaderboard_app_season_user
  ON zook_bodylog_leaderboard_entries (app_id, season_label, user_id);

-- Challenges: filter by status, sort by created_at
CREATE INDEX IF NOT EXISTS idx_bodylog_challenges_status_created
  ON zook_bodylog_challenges (status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bodylog_challenges_creator
  ON zook_bodylog_challenges (creator_user_id, created_at DESC);

-- Growth tables use their historical unprefixed names.
CREATE INDEX IF NOT EXISTS idx_bodylog_growth_plans_status_start
  ON bodylog_seven_day_plans (status, start_date DESC);

CREATE INDEX IF NOT EXISTS idx_bodylog_growth_plans_user
  ON bodylog_seven_day_plans (user_id, start_date DESC);

-- Rewards: filter by claimed status, sort by created_at
CREATE INDEX IF NOT EXISTS idx_bodylog_rewards_claimed_created
  ON bodylog_rewards (claimed, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bodylog_rewards_plan
  ON bodylog_rewards (plan_id, created_at DESC);

-- Friendships have no status column; rows represent active relationships.
CREATE INDEX IF NOT EXISTS idx_bodylog_friendships_user_status
  ON zook_bodylog_friendships (app_id, user_id);

-- Group members: filter by user
CREATE INDEX IF NOT EXISTS idx_bodylog_group_members_user
  ON zook_bodylog_group_members (user_id);

-- Challenge members: filter by challenge and user
CREATE INDEX IF NOT EXISTS idx_bodylog_challenge_members_challenge
  ON zook_bodylog_challenge_members (challenge_id, joined_at DESC);

CREATE INDEX IF NOT EXISTS idx_bodylog_challenge_members_user
  ON zook_bodylog_challenge_members (user_id);

-- Subscriptions: filter by user and tier
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_app_user_tier
  ON zook_user_subscriptions (app_id, user_id, tier);

-- Growth missions: filter by plan and completion status
CREATE INDEX IF NOT EXISTS idx_bodylog_growth_missions_plan_completed
  ON bodylog_missions (plan_id, completed, day);
