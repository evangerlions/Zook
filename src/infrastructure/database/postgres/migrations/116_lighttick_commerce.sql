-- Preserve the existing LightTick order and entitlement authorities; isolate sandbox data.
ALTER TABLE zook_lighttick_user_subscriptions ADD COLUMN IF NOT EXISTS environment TEXT NOT NULL DEFAULT 'production' CHECK(environment IN ('production','sandbox'));
ALTER TABLE zook_lighttick_user_subscriptions DROP CONSTRAINT IF EXISTS zook_lighttick_user_subscriptions_pkey;
ALTER TABLE zook_lighttick_user_subscriptions ADD PRIMARY KEY(app_id,user_id,environment);
ALTER TABLE zook_lighttick_payment_orders ADD COLUMN IF NOT EXISTS environment TEXT NOT NULL DEFAULT 'production' CHECK(environment IN ('production','sandbox'));
ALTER TABLE zook_lighttick_payment_orders ADD COLUMN IF NOT EXISTS merchant_order_id TEXT UNIQUE;
ALTER TABLE zook_lighttick_payment_orders ADD COLUMN IF NOT EXISTS request_key TEXT;
ALTER TABLE zook_lighttick_payment_orders ADD COLUMN IF NOT EXISTS payload JSONB;
ALTER TABLE zook_lighttick_payment_orders DROP CONSTRAINT IF EXISTS zook_lighttick_payment_orders_status_check;
ALTER TABLE zook_lighttick_payment_orders ADD CONSTRAINT zook_lighttick_payment_orders_status_check CHECK(status IN ('pending','paid','failed','refunded','closed'));
CREATE UNIQUE INDEX IF NOT EXISTS zook_lighttick_payment_orders_request ON zook_lighttick_payment_orders(app_id,user_id,environment,request_key);
CREATE INDEX IF NOT EXISTS zook_lighttick_payment_orders_owner_environment ON zook_lighttick_payment_orders(app_id,user_id,environment,created_at DESC);
ALTER TABLE zook_lighttick_payment_orders DROP CONSTRAINT IF EXISTS zook_lighttick_payment_orders_transaction_id_key;
CREATE UNIQUE INDEX IF NOT EXISTS zook_lighttick_payment_orders_provider_transaction ON zook_lighttick_payment_orders(environment,(payload->>'merchantAppId'),transaction_id) WHERE transaction_id IS NOT NULL;
