ALTER TABLE zook_bodylog_buddy_pairs ADD COLUMN IF NOT EXISTS inviter_user_id TEXT;
ALTER TABLE zook_bodylog_groups ADD COLUMN IF NOT EXISTS invitation_token TEXT;
