-- FrogSleep group buddy lifecycle
-- Adds the canonical group table and completes group support on top of the 018 pre-embedding.
-- Phase 2 implementation of group (2-5 person) buddy relationships.
-- Design doc: iOS项目/docs/群组搭子设计方案.md

-- 1) Canonical group table. A group is the primary aggregate; buddy_domain_relationships
--    rows with is_group=TRUE are created for interop, but the group table is the source of truth.
CREATE TABLE IF NOT EXISTS zook_frogsleep_buddy_groups (
  id TEXT PRIMARY KEY CHECK (BTRIM(id) <> ''),
  app_id TEXT NOT NULL REFERENCES zook_apps(id) ON DELETE CASCADE,
  domain TEXT NOT NULL CHECK (domain IN ('sleep', 'focus')),
  group_name TEXT NOT NULL CHECK (BTRIM(group_name) <> ''),
  group_description TEXT,
  owner_user_id TEXT NOT NULL REFERENCES zook_users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('forming', 'active', 'paused', 'dissolved')),
  member_count INTEGER NOT NULL DEFAULT 1 CHECK (member_count BETWEEN 1 AND 5),
  sharing_baseline TEXT[] NOT NULL DEFAULT '{presence,daily_summary}',
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  dissolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (
    (status IN ('forming', 'active', 'paused') AND dissolved_at IS NULL)
    OR (status = 'dissolved' AND dissolved_at IS NOT NULL)
  )
);

-- 2) Indexes for list-by-member (via group members) and owner lookups.
CREATE INDEX IF NOT EXISTS idx_frogsleep_buddy_groups_owner
  ON zook_frogsleep_buddy_groups (app_id, owner_user_id, status);
CREATE INDEX IF NOT EXISTS idx_frogsleep_buddy_groups_domain_status
  ON zook_frogsleep_buddy_groups (app_id, domain, status, updated_at DESC);

-- 3) Group membership completion: invited_at for pending invite tracking.
ALTER TABLE zook_frogsleep_buddy_group_members
  ADD COLUMN IF NOT EXISTS invited_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS invite_expires_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1);

-- 3b) Invitation concurrency control.
ALTER TABLE zook_frogsleep_buddy_group_invitations
  ADD COLUMN IF NOT EXISTS version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1);

-- 4) Group role index (owner fast-path).
CREATE INDEX IF NOT EXISTS idx_frogsleep_buddy_group_members_role
  ON zook_frogsleep_buddy_group_members (app_id, group_id, role)
  WHERE status = 'active';

-- 5) Revise the 018 lifecycle CHECK so forming (member_count=1) is valid and
--    group status supports forming/dissolved. Dropped and re-added idempotently.
ALTER TABLE zook_frogsleep_buddy_domain_relationships
  DROP CONSTRAINT IF EXISTS frogsleep_buddy_domain_relationships_check_1on1_or_group,
  ADD CONSTRAINT frogsleep_buddy_domain_relationships_check_1on1_or_group
    CHECK (
      (is_group = FALSE AND user_id_low IS NOT NULL AND user_id_high IS NOT NULL AND group_id IS NULL AND member_count IS NULL)
      OR
      (is_group = TRUE AND user_id_low IS NULL AND user_id_high IS NULL AND group_id IS NOT NULL
        AND member_count IS NOT NULL AND member_count BETWEEN 1 AND 5)
    );

-- 6) Weekly reports and goals reuse the 011 tables keyed by relationship_id = group id.
--    Nothing to migrate here; the service layer writes group-scoped rows.

-- 7) Governance: forming groups that never reach 2 members are dissolved after 7 days.
CREATE OR REPLACE FUNCTION frogsleep_expire_abandoned_groups(now_ts TIMESTAMPTZ DEFAULT NOW())
RETURNS INTEGER AS $$
DECLARE
  expired INTEGER := 0;
BEGIN
  UPDATE zook_frogsleep_buddy_groups
  SET status = 'dissolved', dissolved_at = now_ts, updated_at = now_ts, version = version + 1
  WHERE status = 'forming' AND created_at < now_ts - INTERVAL '7 days';
  GET DIAGNOSTICS expired = ROW_COUNT;
  RETURN expired;
END;
$$ LANGUAGE plpgsql;

-- Rollback: drop the group table, role index, and governance function after
-- disabling groupBuddies and exporting retention evidence.
