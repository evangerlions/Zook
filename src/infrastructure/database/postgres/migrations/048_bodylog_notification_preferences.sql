-- Migration: 036_bodylog_notification_preferences
-- Description: Create table for user notification preferences
-- Date: 2026-08-27

CREATE TABLE IF NOT EXISTS bodylog_notification_preferences (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(255) NOT NULL,
  enabled_categories JSONB NOT NULL DEFAULT '["sevenDayPlan", "friendRequest", "challengeInvite", "rewardArrived"]'::jsonb,
  quiet_hours_enabled BOOLEAN NOT NULL DEFAULT false,
  quiet_hours_start INTEGER NOT NULL DEFAULT 22,
  quiet_hours_end INTEGER NOT NULL DEFAULT 7,
  merge_requests BOOLEAN NOT NULL DEFAULT true,
  leaderboard_rank_push BOOLEAN NOT NULL DEFAULT false,
  marketing_consent BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT fk_bodylog_notification_preferences_user
    FOREIGN KEY (user_id)
    REFERENCES zook_users(id)
    ON DELETE CASCADE,

  CONSTRAINT uq_bodylog_notification_preferences_user
    UNIQUE (user_id)
);

CREATE INDEX IF NOT EXISTS idx_bodylog_notification_preferences_user_id ON bodylog_notification_preferences(user_id);

COMMENT ON TABLE bodylog_notification_preferences IS 'User notification preferences for BodyLog';
COMMENT ON COLUMN bodylog_notification_preferences.enabled_categories IS 'JSON array of enabled notification categories';
COMMENT ON COLUMN bodylog_notification_preferences.quiet_hours_start IS 'Quiet hours start (0-23)';
COMMENT ON COLUMN bodylog_notification_preferences.quiet_hours_end IS 'Quiet hours end (0-23)';
