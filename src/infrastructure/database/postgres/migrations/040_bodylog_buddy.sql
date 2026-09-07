-- 搭子配对表
CREATE TABLE IF NOT EXISTS zook_bodylog_buddy_pairs (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  partner_user_id TEXT NOT NULL,
  shared_habit_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  status TEXT NOT NULL,
  consecutive_days INTEGER NOT NULL DEFAULT 0,
  max_consecutive INTEGER NOT NULL DEFAULT 0,
  current_tier TEXT,
  last_active_date DATE,
  revival_used_this_month INTEGER NOT NULL DEFAULT 0,
  invited_via TEXT,
  invitation_token TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  accepted_at TIMESTAMPTZ,
  dissolved_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL,

  -- 确保同对用户不重复，小ID在前避免双向重复
  CONSTRAINT uq_bodylog_buddy_pairs UNIQUE (app_id, user_id, partner_user_id),
  CONSTRAINT chk_bodylog_buddy_pairs_user_order CHECK (user_id < partner_user_id)
);

CREATE INDEX IF NOT EXISTS idx_bodylog_buddy_pairs_user
  ON zook_bodylog_buddy_pairs (app_id, user_id, status);

CREATE INDEX IF NOT EXISTS idx_bodylog_buddy_pairs_partner
  ON zook_bodylog_buddy_pairs (app_id, partner_user_id, status);

CREATE INDEX IF NOT EXISTS idx_bodylog_buddy_pairs_status
  ON zook_bodylog_buddy_pairs (app_id, status, created_at);

-- 搭子活动记录表
CREATE TABLE IF NOT EXISTS zook_bodylog_buddy_activities (
  id TEXT PRIMARY KEY,
  pair_id TEXT NOT NULL REFERENCES zook_bodylog_buddy_pairs(id) ON DELETE CASCADE,
  actor_user_id TEXT NOT NULL,
  type TEXT NOT NULL,
  target_habit_id TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_bodylog_buddy_activities_pair
  ON zook_bodylog_buddy_activities (pair_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bodylog_buddy_activities_actor
  ON zook_bodylog_buddy_activities (actor_user_id, created_at DESC);

-- 搭子鼓励记录表
CREATE TABLE IF NOT EXISTS zook_bodylog_buddy_encouragements (
  id TEXT PRIMARY KEY,
  pair_id TEXT NOT NULL REFERENCES zook_bodylog_buddy_pairs(id) ON DELETE CASCADE,
  from_user_id TEXT NOT NULL,
  to_user_id TEXT NOT NULL,
  emoji TEXT NOT NULL,
  is_same_action BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_bodylog_buddy_encouragements_pair
  ON zook_bodylog_buddy_encouragements (pair_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bodylog_buddy_encouragements_to_user
  ON zook_bodylog_buddy_encouragements (to_user_id, created_at DESC);
