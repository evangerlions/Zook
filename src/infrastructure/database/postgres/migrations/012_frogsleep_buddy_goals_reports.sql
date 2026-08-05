CREATE TABLE IF NOT EXISTS zook_frogsleep_buddy_joint_goals
  (LIKE zook_frogsleep_sleep_invites INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES);
CREATE TABLE IF NOT EXISTS zook_frogsleep_buddy_goal_contributions
  (LIKE zook_frogsleep_sleep_invites INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES);
CREATE TABLE IF NOT EXISTS zook_frogsleep_buddy_milestones
  (LIKE zook_frogsleep_sleep_invites INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES);
CREATE TABLE IF NOT EXISTS zook_frogsleep_buddy_weekly_reports
  (LIKE zook_frogsleep_sleep_invites INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES);

CREATE UNIQUE INDEX IF NOT EXISTS uq_frogsleep_buddy_goal_idempotency
  ON zook_frogsleep_buddy_joint_goals (app_id, owner_user_id, relationship_id, (payload->>'idempotency_key'))
  WHERE deleted_at IS NULL AND payload->>'idempotency_key' IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_frogsleep_buddy_goals_relationship_status_window
  ON zook_frogsleep_buddy_joint_goals (app_id, relationship_id, status, starts_at, ends_at)
  WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_frogsleep_buddy_goal_contribution_event
  ON zook_frogsleep_buddy_goal_contributions (app_id, relationship_id, (payload->>'source_event_id'))
  WHERE deleted_at IS NULL AND payload->>'source_event_id' IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_frogsleep_buddy_milestone_rule_window
  ON zook_frogsleep_buddy_milestones (app_id, relationship_id, (payload->>'rule_key'), (payload->>'window_key'))
  WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX IF NOT EXISTS uq_frogsleep_buddy_weekly_report_viewer_window_version
  ON zook_frogsleep_buddy_weekly_reports
    (app_id, relationship_id, owner_user_id, (payload->>'window_start'), (payload->>'version'))
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_frogsleep_buddy_weekly_reports_viewer_time
  ON zook_frogsleep_buddy_weekly_reports (app_id, owner_user_id, created_at DESC)
  WHERE deleted_at IS NULL;

-- Goal payload stores template, bilateral participant consent, timezone source,
-- UTC window, neutral target, version, and idempotency key. Contribution payloads
-- reference verified FrogSleep source events only. Reports store filtered snapshots.
-- Rollback: disable buddy_goals_reports, export retention evidence, then drop these
-- four tables in reverse dependency order.
