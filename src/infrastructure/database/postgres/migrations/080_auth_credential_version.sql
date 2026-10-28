ALTER TABLE zook_users
  ADD COLUMN IF NOT EXISTS credential_version INTEGER NOT NULL DEFAULT 1
  CHECK (credential_version > 0);
