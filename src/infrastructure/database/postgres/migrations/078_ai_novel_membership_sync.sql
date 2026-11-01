-- Development cutover: preserve verified financial identities, rebuild only authorized grants.
CREATE INDEX IF NOT EXISTS zook_alipay_user_sync_idx ON zook_ai_novel_alipay_orders(user_id, environment, order_id);
DO $$
DECLARE item RECORD; prior_key TEXT := ''; current_key TEXT; previous_end TIMESTAMPTZ; begins TIMESTAMPTZ; ends TIMESTAMPTZ; months INTEGER;
BEGIN
  FOR item IN SELECT * FROM zook_ai_novel_alipay_orders
    WHERE status = 'paid' AND membership_applied AND record->>'accountDeletedAt' IS NULL
    AND NOT EXISTS (SELECT 1 FROM zook_ai_novel_billing_transactions t WHERE t.provider = 'alipay' AND t.provider_transaction_id = order_id
      AND t.environment = zook_ai_novel_alipay_orders.environment AND t.status IN ('refunded','revoked'))
    AND record->>'paidAt' IS NOT NULL AND record->>'membershipStartsAt' IS NULL
    ORDER BY user_id, environment, split_part(record->>'productKey','_',1), (record->>'paidAt')::timestamptz, order_id
  LOOP
    current_key := item.user_id || ':' || item.environment || ':' || split_part(item.record->>'productKey','_',1);
    IF current_key <> prior_key THEN previous_end := NULL; END IF;
    begins := GREATEST((item.record->>'paidAt')::timestamptz, previous_end);
    months := CASE WHEN item.record->>'productKey' LIKE '%_yearly' THEN 12 WHEN item.record->>'productKey' LIKE '%_quarterly' THEN 3 ELSE 1 END;
    ends := (begins AT TIME ZONE 'UTC' + make_interval(months => months)) AT TIME ZONE 'UTC';
    UPDATE zook_ai_novel_alipay_orders SET membership_expires_at = ends,
      record = record || jsonb_build_object('membershipStartsAt',to_char(begins AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
        'membershipExpiresAt',to_char(ends AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) WHERE order_id = item.order_id;
    previous_end := ends; prior_key := current_key;
  END LOOP;
END $$;

-- Synchronize derived financial expiry without overwriting payment/refund evidence.
UPDATE zook_ai_novel_billing_transactions t SET expires_at = o.membership_expires_at
FROM zook_ai_novel_alipay_orders o WHERE t.provider = 'alipay' AND t.provider_transaction_id = o.order_id
AND t.environment = o.environment AND t.user_id = o.user_id AND o.membership_applied
AND t.status NOT IN ('refunded','revoked');
