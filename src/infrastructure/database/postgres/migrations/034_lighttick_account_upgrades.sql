ALTER TABLE zook_lighttick_guest_identities
  ADD COLUMN IF NOT EXISTS upgraded_to_user_id TEXT;

CREATE TABLE IF NOT EXISTS zook_lighttick_account_upgrades (
  app_id TEXT NOT NULL DEFAULT 'lighttick' CHECK (app_id = 'lighttick'),
  operation_id TEXT NOT NULL,
  request_hash TEXT NOT NULL,
  guest_user_id TEXT NOT NULL,
  target_user_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('completed')),
  result_payload JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (app_id, operation_id)
);

CREATE INDEX IF NOT EXISTS zook_lighttick_account_upgrades_guest_idx
  ON zook_lighttick_account_upgrades (app_id, guest_user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS zook_lighttick_account_upgrades_target_idx
  ON zook_lighttick_account_upgrades (app_id, target_user_id, created_at DESC);
