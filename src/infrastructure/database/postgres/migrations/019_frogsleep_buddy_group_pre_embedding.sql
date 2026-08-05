-- Group (multi-person buddy) pre-embedding migration
-- Adds support for 2-5 person group relationships while maintaining backward compatibility with 1-on-1 relationships
-- Phase 2 will implement the full group functionality on top of this schema

-- Add group support columns to buddy_domain_relationships
ALTER TABLE zook_frogsleep_buddy_domain_relationships
  ADD COLUMN IF NOT EXISTS is_group BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS group_id TEXT,
  ADD COLUMN IF NOT EXISTS member_count INTEGER,
  ADD COLUMN IF NOT EXISTS group_name TEXT,
  ADD COLUMN IF NOT EXISTS group_description TEXT;

-- Make user_id_low and user_id_high nullable for group relationships
-- For 1-on-1: user_id_low and user_id_high are required
-- For groups: user_id_low and user_id_high are NULL, group_id is required
ALTER TABLE zook_frogsleep_buddy_domain_relationships
  ALTER COLUMN user_id_low DROP NOT NULL,
  ALTER COLUMN user_id_high DROP NOT NULL;

-- Update constraints to support both 1-on-1 and group modes
ALTER TABLE zook_frogsleep_buddy_domain_relationships
  DROP CONSTRAINT IF EXISTS frogsleep_buddy_domain_relationships_check_1on1_or_group,
  ADD CONSTRAINT frogsleep_buddy_domain_relationships_check_1on1_or_group
    CHECK (
      -- 1-on-1 mode: user_id_low and user_id_high are set, group fields are NULL
      (is_group = FALSE AND user_id_low IS NOT NULL AND user_id_high IS NOT NULL AND group_id IS NULL AND member_count IS NULL)
      OR
      -- Group mode: group_id and member_count are set, user_id_low and user_id_high are NULL
      (is_group = TRUE AND user_id_low IS NULL AND user_id_high IS NULL AND group_id IS NOT NULL AND member_count IS NOT NULL AND member_count BETWEEN 2 AND 5)
    );

-- Create group members table for tracking group membership
CREATE TABLE IF NOT EXISTS zook_frogsleep_buddy_group_members (
  id TEXT PRIMARY KEY CHECK (BTRIM(id) <> ''),
  app_id TEXT NOT NULL REFERENCES zook_apps(id) ON DELETE CASCADE,
  group_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES zook_users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('owner', 'member', 'moderator')),
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  left_at TIMESTAMPTZ,
  status TEXT NOT NULL CHECK (status IN ('active', 'left', 'removed')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (app_id, group_id, user_id),
  CHECK (BTRIM(group_id) <> '')
);

-- Index for querying group members
CREATE INDEX IF NOT EXISTS idx_frogsleep_buddy_group_members_group
  ON zook_frogsleep_buddy_group_members (app_id, group_id, status);

CREATE INDEX IF NOT EXISTS idx_frogsleep_buddy_group_members_user
  ON zook_frogsleep_buddy_group_members (app_id, user_id, status);

-- Add group support to invitation bundles
ALTER TABLE zook_frogsleep_buddy_invitation_bundles
  ADD COLUMN IF NOT EXISTS is_group_invitation BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS target_group_id TEXT,
  ADD COLUMN IF NOT EXISTS max_invitees INTEGER,
  ADD COLUMN IF NOT EXISTS invitee_user_ids TEXT[] DEFAULT '{}';

-- Constraint to support both individual and group invitations
ALTER TABLE zook_frogsleep_buddy_invitation_bundles
  DROP CONSTRAINT IF EXISTS frogsleep_buddy_invitation_bundles_check_individual_or_group,
  ADD CONSTRAINT frogsleep_buddy_invitation_bundles_check_individual_or_group
    CHECK (
      -- Individual invitation: invitee_user_id is set, group fields are NULL
      (is_group_invitation = FALSE AND invitee_user_id IS NOT NULL AND target_group_id IS NULL AND max_invitees IS NULL)
      OR
      -- Group invitation: target_group_id is set, invitee_user_id is NULL, max_invitees between 1 and 4
      (is_group_invitation = TRUE AND invitee_user_id IS NULL AND target_group_id IS NOT NULL AND max_invitees IS NOT NULL AND max_invitees BETWEEN 1 AND 4)
    );

-- Add group support to sharing grants (for group-wide grants)
ALTER TABLE zook_frogsleep_buddy_sharing_grants
  ADD COLUMN IF NOT EXISTS is_group_grant BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS grantee_group_id TEXT;

-- Constraint to support both individual and group grants
ALTER TABLE zook_frogsleep_buddy_sharing_grants
  DROP CONSTRAINT IF EXISTS frogsleep_buddy_sharing_grants_check_individual_or_group,
  ADD CONSTRAINT frogsleep_buddy_sharing_grants_check_individual_or_group
    CHECK (
      -- Individual grant: grantee_user_id is set, group fields are NULL
      (is_group_grant = FALSE AND grantee_user_id IS NOT NULL AND grantee_group_id IS NULL)
      OR
      -- Group grant: grantee_group_id is set, grantee_user_id is NULL
      (is_group_grant = TRUE AND grantee_user_id IS NULL AND grantee_group_id IS NOT NULL)
    );

-- Create group invitations table for tracking group-specific invitation workflows
CREATE TABLE IF NOT EXISTS zook_frogsleep_buddy_group_invitations (
  id TEXT PRIMARY KEY CHECK (BTRIM(id) <> ''),
  app_id TEXT NOT NULL REFERENCES zook_apps(id) ON DELETE CASCADE,
  group_id TEXT NOT NULL,
  inviter_user_id TEXT NOT NULL REFERENCES zook_users(id) ON DELETE CASCADE,
  invitee_user_id TEXT REFERENCES zook_users(id) ON DELETE CASCADE,
  invitee_email TEXT,
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled', 'expired')),
  expires_at TIMESTAMPTZ NOT NULL,
  responded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (BTRIM(group_id) <> ''),
  CHECK (invitee_user_id IS NOT NULL OR invitee_email IS NOT NULL)
);

-- Index for querying group invitations
CREATE INDEX IF NOT EXISTS idx_frogsleep_buddy_group_invitations_group
  ON zook_frogsleep_buddy_group_invitations (app_id, group_id, status);

CREATE INDEX IF NOT EXISTS idx_frogsleep_buddy_group_invitations_invitee
  ON zook_frogsleep_buddy_group_invitations (app_id, invitee_user_id, status);

-- Update the unique index on domain_relationships to handle groups
-- Drop the old index and create a new one that excludes groups
DROP INDEX IF EXISTS uq_frogsleep_buddy_domain_relationships_current_pair;

CREATE UNIQUE INDEX IF NOT EXISTS uq_frogsleep_buddy_domain_relationships_current_pair
  ON zook_frogsleep_buddy_domain_relationships (app_id, domain, user_id_low, user_id_high)
  WHERE status IN ('active', 'paused') AND is_group = FALSE;

-- Create index for group lookups
CREATE UNIQUE INDEX IF NOT EXISTS uq_frogsleep_buddy_domain_relationships_group
  ON zook_frogsleep_buddy_domain_relationships (app_id, domain, group_id)
  WHERE status IN ('active', 'paused') AND is_group = TRUE;

-- Add comments for documentation
COMMENT ON TABLE zook_frogsleep_buddy_group_members IS 'Tracks membership in buddy groups (2-5 people). Supports owner, member, and moderator roles.';
COMMENT ON TABLE zook_frogsleep_buddy_group_invitations IS 'Tracks group-specific invitation workflows for joining existing groups.';
COMMENT ON COLUMN zook_frogsleep_buddy_domain_relationships.is_group IS 'TRUE for group relationships (2-5 people), FALSE for 1-on-1 relationships';
COMMENT ON COLUMN zook_frogsleep_buddy_domain_relationships.group_id IS 'Unique identifier for the group (NULL for 1-on-1)';
COMMENT ON COLUMN zook_frogsleep_buddy_domain_relationships.member_count IS 'Number of members in the group (NULL for 1-on-1, 2-5 for groups)';
