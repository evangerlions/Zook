-- 添加邀请码字段（6 位字母数字组合）
ALTER TABLE zook_bodylog_invitations ADD COLUMN IF NOT EXISTS code TEXT;

-- 添加索引以支持通过邀请码查询
CREATE INDEX IF NOT EXISTS idx_bodylog_invitations_code
  ON zook_bodylog_invitations (app_id, code) WHERE code IS NOT NULL;

-- 添加注释说明
COMMENT ON COLUMN zook_bodylog_invitations.code IS '6 位邀请码，用于手动输入绑定邀请关系';
