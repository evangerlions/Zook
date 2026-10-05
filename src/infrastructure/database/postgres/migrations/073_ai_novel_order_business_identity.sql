-- Keep historical identifiers unchanged while permitting descriptive new orders.
ALTER TABLE zook_ai_novel_alipay_orders
  DROP CONSTRAINT IF EXISTS zook_ai_novel_alipay_orders_order_id_check;
ALTER TABLE zook_ai_novel_alipay_orders
  ADD CONSTRAINT zook_ai_novel_alipay_orders_order_id_check
  CHECK (order_id ~ '^(ow_(and|web|win)_[ab](01|03|12)_[A-Za-z0-9_-]{1,6}_[a-f0-9]{16}|(ow|alp)_[a-f0-9]{32})$');
