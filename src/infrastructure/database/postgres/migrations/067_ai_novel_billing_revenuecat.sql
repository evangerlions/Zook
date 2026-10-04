CREATE TABLE IF NOT EXISTS zook_ai_novel_billing_memberships (
  app_id TEXT NOT NULL CHECK (app_id = 'ai_novel'),
  user_id TEXT NOT NULL,
  active BOOLEAN NOT NULL DEFAULT FALSE,
  state TEXT NOT NULL CHECK (state IN ('free', 'active', 'cancelled', 'grace_period', 'expired')),
  tier TEXT CHECK (tier IS NULL OR tier IN ('plus', 'pro')),
  plan_key TEXT,
  expires_at TIMESTAMPTZ,
  auto_renew BOOLEAN,
  source TEXT CHECK (source IS NULL OR source IN ('app_store', 'play_store')),
  management_url TEXT,
  last_synced_at TIMESTAMPTZ NOT NULL,
  account_deleted_at TIMESTAMPTZ,
  PRIMARY KEY (app_id, user_id),
  CHECK (active = FALSE OR (tier IS NOT NULL AND plan_key IS NOT NULL AND source IS NOT NULL))
);

CREATE TABLE IF NOT EXISTS zook_ai_novel_billing_transactions (
  app_id TEXT NOT NULL CHECK (app_id = 'ai_novel'),
  user_id TEXT NOT NULL,
  provider TEXT NOT NULL CHECK (provider = 'revenuecat'),
  provider_transaction_id TEXT NOT NULL,
  product_id TEXT NOT NULL,
  product_key TEXT NOT NULL CHECK (product_key IN (
    'plus_monthly', 'plus_quarterly', 'plus_yearly',
    'pro_monthly', 'pro_quarterly', 'pro_yearly'
  )),
  source TEXT NOT NULL CHECK (source IN ('app_store', 'play_store')),
  platform TEXT CHECK (platform IS NULL OR platform IN ('ios', 'android', 'macos')),
  status TEXT NOT NULL CHECK (status IN ('provider_paid', 'entitlement_active', 'expired', 'refunded', 'revoked')),
  purchased_at TIMESTAMPTZ,
  original_purchase_date TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  refunded_at TIMESTAMPTZ,
  auto_renew BOOLEAN,
  is_sandbox BOOLEAN,
  amount_minor BIGINT CHECK (amount_minor IS NULL OR amount_minor >= 0),
  refund_amount_minor BIGINT CHECK (refund_amount_minor IS NULL OR refund_amount_minor >= 0),
  currency TEXT CHECK (currency IS NULL OR currency ~ '^[A-Z]{3}$'),
  observed_at TIMESTAMPTZ NOT NULL,
  account_deleted_at TIMESTAMPTZ,
  PRIMARY KEY (app_id, user_id, provider_transaction_id)
);

CREATE INDEX IF NOT EXISTS zook_ai_novel_billing_transactions_user_time_idx
  ON zook_ai_novel_billing_transactions (app_id, user_id, observed_at DESC);

CREATE INDEX IF NOT EXISTS zook_ai_novel_billing_transactions_admin_time_idx
  ON zook_ai_novel_billing_transactions (app_id, observed_at DESC, provider_transaction_id ASC, user_id ASC);

CREATE TABLE IF NOT EXISTS zook_ai_novel_billing_webhook_events (
  app_id TEXT NOT NULL CHECK (app_id = 'ai_novel'),
  event_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  user_id TEXT,
  product_id TEXT,
  provider_transaction_id TEXT,
  status TEXT NOT NULL CHECK (status IN ('processed', 'ignored')),
  occurred_at TIMESTAMPTZ,
  processed_at TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (app_id, event_id)
);

CREATE INDEX IF NOT EXISTS zook_ai_novel_billing_webhook_events_user_time_idx
  ON zook_ai_novel_billing_webhook_events (app_id, user_id, processed_at DESC);

CREATE INDEX IF NOT EXISTS zook_ai_novel_billing_webhook_events_transaction_time_idx
  ON zook_ai_novel_billing_webhook_events (app_id, user_id, provider_transaction_id, processed_at DESC, event_id ASC)
  WHERE provider_transaction_id IS NOT NULL;
