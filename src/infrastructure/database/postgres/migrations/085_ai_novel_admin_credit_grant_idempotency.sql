-- One admin grant key identifies one grant in each billing environment, regardless of target user.
CREATE UNIQUE INDEX IF NOT EXISTS zook_ai_novel_admin_credit_grant_key
  ON zook_ai_novel_credit_events (environment, event_id)
  WHERE payload->>'kind' = 'grant' AND payload ? 'adminUser';

CREATE INDEX IF NOT EXISTS zook_ai_novel_admin_credit_grant_history
  ON zook_ai_novel_credit_events (environment, occurred_at DESC, event_id DESC)
  WHERE payload->>'kind' = 'grant' AND payload ? 'adminUser';
