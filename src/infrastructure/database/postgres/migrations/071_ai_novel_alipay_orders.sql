ALTER TABLE zook_ai_novel_billing_memberships DROP CONSTRAINT IF EXISTS zook_ai_novel_billing_memberships_source_check;
ALTER TABLE zook_ai_novel_billing_memberships ADD CONSTRAINT zook_ai_novel_billing_memberships_source_check CHECK (source IS NULL OR source IN ('app_store', 'play_store', 'alipay'));
ALTER TABLE zook_ai_novel_billing_transactions DROP CONSTRAINT IF EXISTS zook_ai_novel_billing_transactions_provider_check;
ALTER TABLE zook_ai_novel_billing_transactions ADD CONSTRAINT zook_ai_novel_billing_transactions_provider_check CHECK (provider IN ('revenuecat', 'alipay'));
ALTER TABLE zook_ai_novel_billing_transactions DROP CONSTRAINT IF EXISTS zook_ai_novel_billing_transactions_source_check;
ALTER TABLE zook_ai_novel_billing_transactions ADD CONSTRAINT zook_ai_novel_billing_transactions_source_check CHECK (source IN ('app_store', 'play_store', 'alipay'));
ALTER TABLE zook_ai_novel_billing_transactions DROP CONSTRAINT IF EXISTS zook_ai_novel_billing_transactions_platform_check;
ALTER TABLE zook_ai_novel_billing_transactions ADD CONSTRAINT zook_ai_novel_billing_transactions_platform_check CHECK (platform IS NULL OR platform IN ('ios', 'android', 'macos', 'web', 'windows'));
ALTER TABLE zook_ai_novel_billing_transactions DROP CONSTRAINT IF EXISTS zook_ai_novel_billing_transactions_status_check;
ALTER TABLE zook_ai_novel_billing_transactions ADD CONSTRAINT zook_ai_novel_billing_transactions_status_check CHECK (status IN ('provider_paid', 'entitlement_active', 'expired', 'refunded', 'revoked', 'unknown', 'pending', 'closed', 'failed'));
ALTER TABLE zook_ai_novel_billing_transactions ADD COLUMN IF NOT EXISTS provider_order_id TEXT;
ALTER TABLE zook_ai_novel_billing_transactions ADD COLUMN IF NOT EXISTS checkout_id TEXT;
ALTER TABLE zook_ai_novel_billing_transactions ADD COLUMN IF NOT EXISTS distribution TEXT;
ALTER TABLE zook_ai_novel_billing_transactions ADD COLUMN IF NOT EXISTS created_at TIMESTAMPTZ;

-- Existing shared tables remain the authoritative membership/financial/admin projections.
-- This table holds checkout identity, frozen merchant/price and exactly-once grants.
CREATE TABLE IF NOT EXISTS zook_ai_novel_alipay_orders (
  order_id TEXT PRIMARY KEY CHECK (order_id ~ '^alp_[a-f0-9]{32}$'),
  app_id TEXT NOT NULL CHECK (app_id = 'ai_novel'),
  user_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending', 'paid', 'closed', 'failed')),
  expires_at TIMESTAMPTZ NOT NULL,
  membership_expires_at TIMESTAMPTZ,
  membership_applied BOOLEAN NOT NULL DEFAULT FALSE,
  environment TEXT NOT NULL CHECK (environment IN ('sandbox', 'production')),
  provider_transaction_id TEXT,
  record JSONB NOT NULL,
  UNIQUE (app_id, user_id, idempotency_key),
  UNIQUE (environment, provider_transaction_id)
);
CREATE INDEX IF NOT EXISTS zook_ai_novel_alipay_orders_access_idx ON zook_ai_novel_alipay_orders (user_id, membership_expires_at) WHERE membership_applied;
