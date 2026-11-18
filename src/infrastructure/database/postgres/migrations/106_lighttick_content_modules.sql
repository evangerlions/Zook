-- 106_lighttick_content_modules.sql
-- 支持多内容模块（英文阅读、认知阅读、每日通识、思维工具、结构化表达、深度写作）

-- 1. 创建内容模块表
CREATE TABLE IF NOT EXISTS zook_lighttick_learning_modules (
  app_id TEXT NOT NULL CHECK(app_id='lighttick'),
  user_id TEXT NOT NULL,
  id TEXT NOT NULL CHECK (id ~ '^[a-z][a-z0-9-]{0,79}$'),
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  description TEXT NOT NULL DEFAULT '' CHECK (char_length(description) <= 2000),
  enabled BOOLEAN NOT NULL DEFAULT true,
  source_type TEXT NOT NULL DEFAULT 'manual' CHECK (source_type IN ('github', 'local', 'manual')),
  source_url TEXT CHECK (source_url IS NULL OR char_length(source_url) <= 1500),
  source_path TEXT CHECK (source_path IS NULL OR char_length(source_path) <= 500),
  revision INT NOT NULL DEFAULT 1 CHECK (revision >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (app_id, user_id, id)
);

-- 2. 扩展现有表，增加 module_id 字段
ALTER TABLE zook_lighttick_learning_collections
  ADD COLUMN IF NOT EXISTS module_id TEXT CHECK (module_id IS NULL OR module_id ~ '^[a-z][a-z0-9-]{0,79}$');

ALTER TABLE zook_lighttick_learning_collections
  ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';

ALTER TABLE zook_lighttick_native_lessons
  ADD COLUMN IF NOT EXISTS module_id TEXT CHECK (module_id IS NULL OR module_id ~ '^[a-z][a-z0-9-]{0,79}$');

ALTER TABLE zook_lighttick_native_learning_private
  ADD COLUMN IF NOT EXISTS module_id TEXT CHECK (module_id IS NULL OR module_id ~ '^[a-z][a-z0-9-]{0,79}$');

-- 3. 创建索引
CREATE INDEX IF NOT EXISTS idx_learning_modules_user
  ON zook_lighttick_learning_modules (app_id, user_id);

CREATE INDEX IF NOT EXISTS idx_learning_modules_enabled
  ON zook_lighttick_learning_modules (app_id, user_id) WHERE enabled = true;

CREATE INDEX IF NOT EXISTS idx_learning_collections_module
  ON zook_lighttick_learning_collections (app_id, user_id, module_id)
  WHERE module_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_native_lessons_module
  ON zook_lighttick_native_lessons (app_id, user_id, module_id, collection_id)
  WHERE module_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_native_private_module
  ON zook_lighttick_native_learning_private (app_id, user_id, module_id, lesson_id)
  WHERE module_id IS NOT NULL;

-- 4. 创建模块模板表（系统级，不按用户分）
CREATE TABLE IF NOT EXISTS zook_lighttick_learning_module_templates (
  id TEXT PRIMARY KEY CHECK (id ~ '^[a-z][a-z0-9-]{0,79}$'),
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 200),
  description TEXT NOT NULL DEFAULT '' CHECK (char_length(description) <= 2000),
  source_type TEXT NOT NULL DEFAULT 'manual' CHECK (source_type IN ('github', 'local', 'manual')),
  source_url TEXT CHECK (source_url IS NULL OR char_length(source_url) <= 1500),
  source_path TEXT CHECK (source_path IS NULL OR char_length(source_path) <= 500),
  display_order INT NOT NULL DEFAULT 0
);

INSERT INTO zook_lighttick_learning_module_templates (id, title, description, source_type, display_order)
VALUES
  ('english-reading', '英文阅读', '12 周英文阅读训练，保留理解与问题', 'manual', 1),
  ('cognitive-reading', '认知阅读', '区分事实、观点和依据', 'manual', 2),
  ('daily-cognitive', '每日认知通识', '24 周通识学习，培养认知习惯', 'manual', 3),
  ('thinking-tools', '现代思维工具', '7 阶段拆解问题、分析与决策', 'manual', 4),
  ('structured-expression', '结构化表达', '8 周教材，先给结论再组织依据', 'manual', 5),
  ('deep-writing', '深度写作', '按作品推进，形成观点接受反馈', 'manual', 6)
ON CONFLICT (id) DO NOTHING;
