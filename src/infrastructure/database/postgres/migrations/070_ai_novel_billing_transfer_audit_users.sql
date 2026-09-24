ALTER TABLE zook_ai_novel_billing_webhook_events
  ADD COLUMN IF NOT EXISTS affected_user_ids TEXT[] NOT NULL DEFAULT '{}';

CREATE INDEX IF NOT EXISTS zook_ai_novel_billing_webhook_affected_users_idx
  ON zook_ai_novel_billing_webhook_events USING GIN (affected_user_ids);
