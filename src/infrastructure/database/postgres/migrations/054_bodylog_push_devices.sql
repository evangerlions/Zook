-- Migration: 038_bodylog_push_devices
-- Description: Create table for user push notification devices
-- Date: 2026-09-01

CREATE TABLE IF NOT EXISTS bodylog_push_devices (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id VARCHAR(255) NOT NULL,
  device_token TEXT NOT NULL,
  platform VARCHAR(16) NOT NULL CHECK (platform IN ('ios', 'android')),
  name VARCHAR(255) NOT NULL DEFAULT '',
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

  CONSTRAINT fk_bodylog_push_devices_user
    FOREIGN KEY (user_id)
    REFERENCES zook_users(id)
    ON DELETE CASCADE,

  CONSTRAINT uq_bodylog_push_devices_token
    UNIQUE (device_token)
);

CREATE INDEX IF NOT EXISTS idx_bodylog_push_devices_user_id ON bodylog_push_devices(user_id);
CREATE INDEX IF NOT EXISTS idx_bodylog_push_devices_last_seen_at ON bodylog_push_devices(last_seen_at DESC);

COMMENT ON TABLE bodylog_push_devices IS 'Registered push notification devices for BodyLog users';
COMMENT ON COLUMN bodylog_push_devices.device_token IS 'Platform push token (APNs device token or FCM registration token)';
COMMENT ON COLUMN bodylog_push_devices.platform IS 'Device platform: ios or android';
COMMENT ON COLUMN bodylog_push_devices.last_seen_at IS 'Last time the device refreshed its token';
