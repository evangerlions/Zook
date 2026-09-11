-- BodyLog 用户订阅状态表
-- 用于存储 IAP 验证后的订阅信息，供 Premium 功能检查使用

CREATE TABLE IF NOT EXISTS zook_user_subscriptions (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES zook_users(id) ON DELETE CASCADE,
  tier TEXT NOT NULL,                          -- 'free', 'plus', 'pro'
  started_at TIMESTAMPTZ NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  original_transaction_id TEXT,                -- StoreKit original transaction ID
  auto_renew BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_user_subscriptions_user ON zook_user_subscriptions(app_id, user_id);
CREATE INDEX IF NOT EXISTS idx_user_subscriptions_expires ON zook_user_subscriptions(expires_at);
CREATE UNIQUE INDEX IF NOT EXISTS idx_user_subscriptions_transaction ON zook_user_subscriptions(original_transaction_id) WHERE original_transaction_id IS NOT NULL;

-- 订阅历史记录（用于审计和恢复）
CREATE TABLE IF NOT EXISTS zook_subscription_events (
  id TEXT PRIMARY KEY,
  subscription_id TEXT NOT NULL REFERENCES zook_user_subscriptions(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,                    -- 'created', 'renewed', 'cancelled', 'expired', 'upgraded'
  tier TEXT NOT NULL,
  occurred_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb
);

CREATE INDEX IF NOT EXISTS idx_subscription_events_subscription ON zook_subscription_events(subscription_id, occurred_at DESC);
