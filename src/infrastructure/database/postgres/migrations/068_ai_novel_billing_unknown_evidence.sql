ALTER TABLE zook_ai_novel_billing_transactions
  DROP CONSTRAINT IF EXISTS zook_ai_novel_billing_transactions_status_check;

ALTER TABLE zook_ai_novel_billing_transactions
  ADD CONSTRAINT zook_ai_novel_billing_transactions_status_check
  CHECK (status IN ('provider_paid', 'entitlement_active', 'expired', 'refunded', 'revoked', 'unknown'));
