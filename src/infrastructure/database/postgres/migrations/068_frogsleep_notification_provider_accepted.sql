ALTER TABLE zook_frogsleep_buddy_notification_deliveries
  DROP CONSTRAINT IF EXISTS zook_frogsleep_buddy_notification_deliveries_status_check;
ALTER TABLE zook_frogsleep_buddy_notification_deliveries
  ADD CONSTRAINT zook_frogsleep_buddy_notification_deliveries_status_check
  CHECK (status IN ('pending','provider_accepted','delivered','failed','suppressed'));
