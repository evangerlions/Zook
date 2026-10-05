-- New orders identify OrangeWrite. Preserve existing financial order identifiers.
ALTER TABLE zook_ai_novel_alipay_orders
  DROP CONSTRAINT IF EXISTS zook_ai_novel_alipay_orders_order_id_check;
ALTER TABLE zook_ai_novel_alipay_orders
  ADD CONSTRAINT zook_ai_novel_alipay_orders_order_id_check
  CHECK (order_id ~ '^(ow|alp)_[a-f0-9]{32}$');
