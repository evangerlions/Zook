-- The same retry identity may be used independently in both payment environments.
CREATE UNIQUE INDEX IF NOT EXISTS zook_alipay_environment_idempotency_key
  ON zook_ai_novel_alipay_orders (app_id, user_id, environment, idempotency_key);
ALTER TABLE zook_ai_novel_alipay_orders
  DROP CONSTRAINT IF EXISTS zook_ai_novel_alipay_orders_app_id_user_id_idempotency_key_key;
