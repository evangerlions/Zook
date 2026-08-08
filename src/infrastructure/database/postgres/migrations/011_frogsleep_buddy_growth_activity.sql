CREATE TABLE IF NOT EXISTS zook_frogsleep_buddy_shares
  (LIKE zook_frogsleep_sleep_invites INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES);
CREATE TABLE IF NOT EXISTS zook_frogsleep_buddy_interactions
  (LIKE zook_frogsleep_sleep_invites INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES);
CREATE TABLE IF NOT EXISTS zook_frogsleep_buddy_joint_activities
  (LIKE zook_frogsleep_sleep_invites INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES);

CREATE INDEX IF NOT EXISTS idx_frogsleep_buddy_shares_relationship_time
  ON zook_frogsleep_buddy_shares (app_id, relationship_id, created_at DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_frogsleep_buddy_interactions_relationship_time
  ON zook_frogsleep_buddy_interactions (app_id, relationship_id, created_at DESC)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_frogsleep_buddy_joint_activities_relationship_status_time
  ON zook_frogsleep_buddy_joint_activities (app_id, relationship_id, status, created_at DESC)
  WHERE deleted_at IS NULL;

-- Rollback: drop the three tables only after P1 is disabled and retention export is complete.
