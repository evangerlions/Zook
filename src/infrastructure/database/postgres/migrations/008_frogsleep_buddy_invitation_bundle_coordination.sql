ALTER TABLE zook_frogsleep_buddy_invitation_bundles
  ADD COLUMN IF NOT EXISTS domain_invitation_ids JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS domain_error_codes JSONB NOT NULL DEFAULT '{}'::jsonb,
  ADD COLUMN IF NOT EXISTS last_idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS last_response_action TEXT,
  ADD COLUMN IF NOT EXISTS response_payload JSONB;

ALTER TABLE zook_frogsleep_buddy_invitation_bundles
  DROP CONSTRAINT IF EXISTS chk_frogsleep_bundle_response_action;
ALTER TABLE zook_frogsleep_buddy_invitation_bundles
  ADD CONSTRAINT chk_frogsleep_bundle_response_action
  CHECK (last_response_action IS NULL OR last_response_action IN ('accept', 'decline', 'cancel'));

CREATE INDEX IF NOT EXISTS idx_frogsleep_buddy_bundles_inbox
  ON zook_frogsleep_buddy_invitation_bundles (app_id, invitee_user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_frogsleep_buddy_bundles_outbox
  ON zook_frogsleep_buddy_invitation_bundles (app_id, inviter_user_id, status, created_at DESC);
