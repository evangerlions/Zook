-- 添加邀请意图字段
ALTER TABLE zook_bodylog_invitations ADD COLUMN IF NOT EXISTS intent TEXT NOT NULL DEFAULT 'general';

-- 添加索引以支持按意图查询
CREATE INDEX IF NOT EXISTS idx_bodylog_invitations_intent
  ON zook_bodylog_invitations (app_id, intent, created_at DESC);
