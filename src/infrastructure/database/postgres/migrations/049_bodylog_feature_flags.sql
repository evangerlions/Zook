-- Migration: 037_bodylog_feature_flags
-- Description: Create table for feature flags
-- Date: 2026-08-27

CREATE TABLE IF NOT EXISTS bodylog_feature_flags (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key VARCHAR(255) NOT NULL UNIQUE,
  enabled BOOLEAN NOT NULL DEFAULT false,
  description TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_bodylog_feature_flags_key ON bodylog_feature_flags(key);

-- Insert default feature flags
INSERT INTO bodylog_feature_flags (key, enabled, description) VALUES
  ('growth', false, 'Enable 7-day growth plan feature'),
  ('friends', false, 'Enable friends feature'),
  ('competition', false, 'Enable competition feature'),
  ('challengeCreation', false, 'Enable challenge creation feature')
ON CONFLICT (key) DO NOTHING;

COMMENT ON TABLE bodylog_feature_flags IS 'Feature flags for BodyLog';
COMMENT ON COLUMN bodylog_feature_flags.key IS 'Feature flag key';
COMMENT ON COLUMN bodylog_feature_flags.enabled IS 'Whether the feature is enabled';
COMMENT ON COLUMN bodylog_feature_flags.description IS 'Description of the feature flag';
