CREATE TABLE IF NOT EXISTS zook_frogsleep_guest_identities (
  user_id TEXT PRIMARY KEY REFERENCES zook_users(id) ON DELETE CASCADE,
  device_hash TEXT NOT NULL, secret_hash TEXT NOT NULL, document JSONB NOT NULL,
  UNIQUE(device_hash,secret_hash)
);
CREATE TABLE IF NOT EXISTS zook_frogsleep_guest_creations (
  operation_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES zook_users(id) ON DELETE CASCADE, document JSONB NOT NULL
);
CREATE TABLE IF NOT EXISTS zook_frogsleep_guest_upgrades (
  guest_user_id TEXT PRIMARY KEY REFERENCES zook_users(id) ON DELETE CASCADE,
  target_user_id TEXT NOT NULL REFERENCES zook_users(id) ON DELETE CASCADE, document JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_frogsleep_guest_upgrade_target ON zook_frogsleep_guest_upgrades(target_user_id);
