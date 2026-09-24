ALTER TABLE zook_ai_novel_billing_webhook_events
  ADD COLUMN IF NOT EXISTS account_deleted_at TIMESTAMPTZ;
