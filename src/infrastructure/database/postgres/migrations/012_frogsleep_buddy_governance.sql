-- FrogSleep buddy retention windows are intentionally table-specific. Deletion
-- is soft-first where relationship auditability is required and hard for derived
-- notification/share payloads after the documented window.
CREATE OR REPLACE FUNCTION frogsleep_purge_expired_buddy_data(run_at timestamptz)
RETURNS TABLE(resource text, deleted_count bigint)
LANGUAGE plpgsql AS $$
BEGIN
  RETURN QUERY WITH gone AS (
    DELETE FROM zook_frogsleep_buddy_notification_deliveries
    WHERE created_at < run_at - interval '30 days' RETURNING 1)
    SELECT 'notification_delivery', count(*) FROM gone;
  RETURN QUERY WITH gone AS (
    DELETE FROM zook_frogsleep_buddy_notifications
    WHERE created_at < run_at - interval '90 days' RETURNING 1)
    SELECT 'notification_feed', count(*) FROM gone;
  RETURN QUERY WITH gone AS (
    DELETE FROM zook_frogsleep_buddy_shares
    WHERE created_at < run_at - interval '30 days' RETURNING 1)
    SELECT 'structured_share', count(*) FROM gone;
  RETURN QUERY WITH gone AS (
    DELETE FROM zook_frogsleep_buddy_interactions
    WHERE created_at < run_at - interval '90 days' RETURNING 1)
    SELECT 'interaction', count(*) FROM gone;
  RETURN QUERY WITH gone AS (
    DELETE FROM zook_frogsleep_buddy_invitation_receipts
    WHERE created_at < run_at - interval '90 days' RETURNING 1)
    SELECT 'invitation_projection', count(*) FROM gone;
END $$;

CREATE INDEX IF NOT EXISTS idx_frogsleep_buddy_notifications_retention
  ON zook_frogsleep_buddy_notifications (created_at);
CREATE INDEX IF NOT EXISTS idx_frogsleep_buddy_shares_retention
  ON zook_frogsleep_buddy_shares (created_at);
CREATE INDEX IF NOT EXISTS idx_frogsleep_buddy_interactions_retention
  ON zook_frogsleep_buddy_interactions (created_at);

-- Audit records remain 730 days; completed goals 365 days; viewer-filtered weekly
-- reports 400 days. Revoked relationship payload access ends immediately and its
-- derived display cache is eligible for deletion after 30 days.
-- Rollback: stop the scheduled purge job, drop this function and these indexes.
