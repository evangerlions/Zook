-- 107_lighttick_storage_quota.sql
-- 添加存储配额、付费套餐和内容同步功能

-- 1. 扩展 learning_modules 表，添加所有者、公开状态、同步状态等字段
ALTER TABLE zook_lighttick_learning_modules
  ADD COLUMN IF NOT EXISTS owner_id TEXT,
  ADD COLUMN IF NOT EXISTS is_public BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS subscriber_count INT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS last_synced_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sync_status TEXT NOT NULL DEFAULT 'idle'
    CHECK (sync_status IN ('idle', 'syncing', 'error', 'disabled')),
  ADD COLUMN IF NOT EXISTS storage_used BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS source_config JSONB,
  ADD COLUMN IF NOT EXISTS storage_config JSONB;

-- 2. 创建用户订阅表（付费套餐）
CREATE TABLE IF NOT EXISTS zook_lighttick_user_subscriptions (
  app_id TEXT NOT NULL CHECK(app_id='lighttick'),
  user_id TEXT NOT NULL,
  plan_id TEXT NOT NULL CHECK (plan_id IN ('basic', 'premium', 'professional', 'enterprise')),
  status TEXT NOT NULL CHECK (status IN ('active', 'cancelled', 'expired', 'pending')),
  current_period_start TIMESTAMPTZ NOT NULL,
  current_period_end TIMESTAMPTZ NOT NULL,
  cancel_at_period_end BOOLEAN NOT NULL DEFAULT false,
  payment_method_type TEXT CHECK (payment_method_type IN ('alipay', 'wechat', 'stripe')),
  payment_method_last4 TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (app_id, user_id)
);

-- 3. 创建用户存储配置表
CREATE TABLE IF NOT EXISTS zook_lighttick_user_storage (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id TEXT NOT NULL CHECK(app_id='lighttick'),
  user_id TEXT NOT NULL,
  storage_type TEXT NOT NULL CHECK (storage_type IN ('cloud', 'github', 'local', 'hybrid')),
  config JSONB NOT NULL,
  is_default BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'error', 'pending')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(app_id, user_id, storage_type)
);

-- 4. 创建内容发布队列表（复用 grow 的 journal 模式）
CREATE TABLE IF NOT EXISTS zook_lighttick_content_publications (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL CHECK(app_id='lighttick'),
  user_id TEXT NOT NULL,
  module_id TEXT,
  request_hash TEXT NOT NULL,
  state TEXT NOT NULL CHECK (state IN ('pending', 'processing', 'done', 'failed')),
  files JSONB NOT NULL,
  sql_operations JSONB,
  commit_sha TEXT,
  parent_sha TEXT,
  binding JSONB,
  error_code TEXT,
  error_message TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  finished_at TIMESTAMPTZ
);

-- 5. 创建内容文档元数据表
CREATE TABLE IF NOT EXISTS zook_lighttick_content_documents (
  path TEXT NOT NULL,
  app_id TEXT NOT NULL CHECK(app_id='lighttick'),
  user_id TEXT NOT NULL,
  module_id TEXT,
  hash TEXT NOT NULL,
  size BIGINT NOT NULL DEFAULT 0,
  storage TEXT NOT NULL CHECK (storage IN ('github', 'database', 's3', 'archive')),
  commit_sha TEXT,
  text TEXT,
  compression TEXT CHECK (compression IN ('none', 'gzip', 'brotli')),
  tier TEXT NOT NULL DEFAULT 'warm' CHECK (tier IN ('hot', 'warm', 'cold')),
  last_accessed_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (path, app_id, user_id)
);

-- 6. 创建内容引用表（去重）
CREATE TABLE IF NOT EXISTS zook_lighttick_content_refs (
  hash TEXT NOT NULL,
  app_id TEXT NOT NULL CHECK(app_id='lighttick'),
  user_id TEXT NOT NULL,
  path TEXT NOT NULL,
  module_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (hash, app_id, user_id, path)
);

-- 7. 创建模块订阅表
CREATE TABLE IF NOT EXISTS zook_lighttick_module_subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id TEXT NOT NULL CHECK(app_id='lighttick'),
  user_id TEXT NOT NULL,
  module_id TEXT NOT NULL,
  owner_id TEXT NOT NULL,
  auto_sync BOOLEAN NOT NULL DEFAULT true,
  subscribed_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  last_synced_at TIMESTAMPTZ,
  UNIQUE(app_id, user_id, module_id)
);

-- 8. 创建模块来源配置表
CREATE TABLE IF NOT EXISTS zook_lighttick_module_sources (
  module_id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL CHECK(app_id='lighttick'),
  user_id TEXT NOT NULL,
  source_type TEXT NOT NULL,
  source_config JSONB NOT NULL,
  storage_config JSONB NOT NULL,
  last_synced_at TIMESTAMPTZ,
  sync_status TEXT NOT NULL DEFAULT 'idle',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 9. 创建 API 调用配额表
CREATE TABLE IF NOT EXISTS zook_lighttick_api_usage_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id TEXT NOT NULL CHECK(app_id='lighttick'),
  user_id TEXT NOT NULL,
  endpoint TEXT NOT NULL,
  method TEXT NOT NULL,
  timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  response_time INT,
  status_code INT
);

-- 10. 创建支付订单表
CREATE TABLE IF NOT EXISTS zook_lighttick_payment_orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  app_id TEXT NOT NULL CHECK(app_id='lighttick'),
  user_id TEXT NOT NULL,
  plan_id TEXT NOT NULL,
  amount BIGINT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'CNY',
  payment_method TEXT NOT NULL CHECK (payment_method IN ('alipay', 'wechat', 'stripe')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'paid', 'failed', 'refunded')),
  transaction_id TEXT UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  paid_at TIMESTAMPTZ,
  refunded_at TIMESTAMPTZ
);

-- 11. 创建索引
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_status
  ON zook_lighttick_user_subscriptions (app_id, user_id, status);

CREATE INDEX IF NOT EXISTS idx_user_storage_user
  ON zook_lighttick_user_storage (app_id, user_id);

CREATE INDEX IF NOT EXISTS idx_content_publications_state
  ON zook_lighttick_content_publications (app_id, user_id, state);

CREATE INDEX IF NOT EXISTS idx_content_documents_user_size
  ON zook_lighttick_content_documents (app_id, user_id, size);

CREATE INDEX IF NOT EXISTS idx_content_documents_hash
  ON zook_lighttick_content_documents (hash);

CREATE INDEX IF NOT EXISTS idx_content_documents_tier
  ON zook_lighttick_content_documents (tier, last_accessed_at);

CREATE INDEX IF NOT EXISTS idx_content_refs_hash
  ON zook_lighttick_content_refs (hash);

CREATE INDEX IF NOT EXISTS idx_module_subscriptions_user
  ON zook_lighttick_module_subscriptions (app_id, user_id);

CREATE INDEX IF NOT EXISTS idx_api_usage_user_timestamp
  ON zook_lighttick_api_usage_logs (app_id, user_id, timestamp);

CREATE INDEX IF NOT EXISTS idx_payment_orders_user
  ON zook_lighttick_payment_orders (app_id, user_id, status);

CREATE INDEX IF NOT EXISTS idx_learning_modules_public
  ON zook_lighttick_learning_modules (app_id, owner_id)
  WHERE is_public = true;

-- 12. 插入默认套餐（basic 免费）
-- 注：套餐配置存储在应用层，这里只创建表结构
