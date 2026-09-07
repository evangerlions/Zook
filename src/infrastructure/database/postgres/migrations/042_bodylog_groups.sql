-- 打卡小组表
CREATE TABLE IF NOT EXISTS zook_bodylog_groups (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL,
  name TEXT NOT NULL,
  icon TEXT,
  leader_user_id TEXT NOT NULL,
  shared_habit_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  completion_rule TEXT NOT NULL DEFAULT 'all', -- 'all': 全员完成, 'majority': 多数人完成
  max_members INTEGER NOT NULL DEFAULT 5,
  status TEXT NOT NULL DEFAULT 'active', -- 'active', 'inactive', 'archived'
  consecutive_days INTEGER NOT NULL DEFAULT 0,
  max_consecutive INTEGER NOT NULL DEFAULT 0,
  current_tier TEXT,
  last_active_date DATE,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,

  CONSTRAINT chk_bodylog_groups_name_length CHECK (char_length(name) >= 1 AND char_length(name) <= 50),
  CONSTRAINT chk_bodylog_groups_max_members CHECK (max_members >= 2 AND max_members <= 5)
);

CREATE INDEX IF NOT EXISTS idx_bodylog_groups_leader
  ON zook_bodylog_groups (app_id, leader_user_id, status);

CREATE INDEX IF NOT EXISTS idx_bodylog_groups_status
  ON zook_bodylog_groups (app_id, status, created_at DESC);

-- 小组成员表
CREATE TABLE IF NOT EXISTS zook_bodylog_group_members (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES zook_bodylog_groups(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member', -- 'leader', 'admin', 'member'
  joined_at TIMESTAMPTZ NOT NULL,
  invitation_token TEXT,
  status TEXT NOT NULL DEFAULT 'active', -- 'pending', 'active', 'left', 'removed'

  CONSTRAINT uq_bodylog_group_members UNIQUE (group_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_bodylog_group_members_user
  ON zook_bodylog_group_members (user_id, status);

CREATE INDEX IF NOT EXISTS idx_bodylog_group_members_group
  ON zook_bodylog_group_members (group_id, status);

-- 小组每日记录表
CREATE TABLE IF NOT EXISTS zook_bodylog_group_daily_records (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES zook_bodylog_groups(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  completed_user_ids JSONB NOT NULL DEFAULT '[]'::jsonb,
  total_members INTEGER NOT NULL,
  completed_count INTEGER NOT NULL DEFAULT 0,
  completion_rate DECIMAL(5,2) NOT NULL DEFAULT 0.00,
  created_at TIMESTAMPTZ NOT NULL,

  CONSTRAINT uq_bodylog_group_daily_records UNIQUE (group_id, date)
);

CREATE INDEX IF NOT EXISTS idx_bodylog_group_daily_records_group
  ON zook_bodylog_group_daily_records (group_id, date DESC);

CREATE INDEX IF NOT EXISTS idx_bodylog_group_daily_records_date
  ON zook_bodylog_group_daily_records (date DESC);

-- 小组活动记录表（用于动态流）
CREATE TABLE IF NOT EXISTS zook_bodylog_group_activities (
  id TEXT PRIMARY KEY,
  group_id TEXT NOT NULL REFERENCES zook_bodylog_groups(id) ON DELETE CASCADE,
  actor_user_id TEXT NOT NULL,
  type TEXT NOT NULL, -- 'joined', 'left', 'checked_in', 'encouraged', 'milestone'
  target_habit_id TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_bodylog_group_activities_group
  ON zook_bodylog_group_activities (group_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bodylog_group_activities_actor
  ON zook_bodylog_group_activities (actor_user_id, created_at DESC);
