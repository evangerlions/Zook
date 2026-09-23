-- 习惯模板表
CREATE TABLE IF NOT EXISTS zook_bodylog_habit_templates (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL,
  template_key TEXT NOT NULL,
  category TEXT NOT NULL DEFAULT 'general',
  names JSONB NOT NULL DEFAULT '{}'::jsonb,
  icon TEXT,
  default_target_count INTEGER NOT NULL DEFAULT 1,
  sort_order INTEGER NOT NULL DEFAULT 0,
  status TEXT NOT NULL DEFAULT 'active',
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  CONSTRAINT uq_bodylog_habit_templates_key UNIQUE (app_id, template_key)
);

CREATE INDEX IF NOT EXISTS idx_bodylog_habit_templates_app
  ON zook_bodylog_habit_templates (app_id, status, category, sort_order);

-- 管理后台查询优化索引
CREATE INDEX IF NOT EXISTS idx_bodylog_groups_last_active
  ON zook_bodylog_groups (app_id, last_active_date DESC);

CREATE INDEX IF NOT EXISTS idx_bodylog_group_activities_type_created
  ON zook_bodylog_group_activities (type, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_bodylog_daily_records_completed_users
  ON zook_bodylog_group_daily_records USING GIN (completed_user_ids jsonb_path_ops);

-- 种子数据（幂等）
INSERT INTO zook_bodylog_habit_templates (id, app_id, template_key, category, names, icon, default_target_count, sort_order, status, created_at, updated_at)
VALUES
  ('habit_water', 'bodylog', 'water', 'health', '{"zh-CN":"喝水","en-US":"Drink water"}'::jsonb, 'water', 8, 10, 'active', NOW(), NOW()),
  ('habit_exercise', 'bodylog', 'exercise', 'fitness', '{"zh-CN":"运动","en-US":"Exercise"}'::jsonb, 'run', 1, 20, 'active', NOW(), NOW()),
  ('habit_read', 'bodylog', 'read', 'growth', '{"zh-CN":"阅读","en-US":"Read"}'::jsonb, 'book', 1, 30, 'active', NOW(), NOW()),
  ('habit_sleep', 'bodylog', 'sleep', 'health', '{"zh-CN":"早睡","en-US":"Sleep early"}'::jsonb, 'moon', 1, 40, 'active', NOW(), NOW())
ON CONFLICT (id) DO NOTHING;
