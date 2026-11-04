ALTER TABLE zook_frogsleep_buddy_invitation_bundles ADD COLUMN IF NOT EXISTS inviter_read_at TIMESTAMPTZ;
ALTER TABLE zook_frogsleep_buddy_invitation_bundles ADD COLUMN IF NOT EXISTS invitee_read_at TIMESTAMPTZ;
