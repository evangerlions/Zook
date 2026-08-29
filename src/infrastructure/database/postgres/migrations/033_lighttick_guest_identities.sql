CREATE TABLE IF NOT EXISTS zook_lighttick_guest_identities (
  app_id TEXT NOT NULL DEFAULT 'lighttick' CHECK (app_id = 'lighttick'),
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  device_secret_hash TEXT NOT NULL,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android')),
  timezone TEXT NOT NULL,
  locale TEXT NOT NULL,
  app_version TEXT NOT NULL,
  upgrade_token_hash TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (app_id, user_id),
  UNIQUE (app_id, device_id)
);

CREATE INDEX IF NOT EXISTS zook_lighttick_guest_expiry_idx
  ON zook_lighttick_guest_identities (expires_at)
  WHERE revoked_at IS NULL;
