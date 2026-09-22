-- Migration: 050_enable_bodylog_features
-- Description: Enable BodyLog social features for production
-- Date: 2026-09-19

-- Enable existing feature flags
UPDATE bodylog_feature_flags SET enabled = true WHERE key IN ('growth', 'friends', 'competition', 'challengeCreation');

-- Add new accountSocial feature flag
INSERT INTO bodylog_feature_flags (key, enabled, description) VALUES
  ('accountSocial', true, 'Enable social hub feature (friends, buddies, groups)')
ON CONFLICT (key) DO UPDATE SET enabled = true;
