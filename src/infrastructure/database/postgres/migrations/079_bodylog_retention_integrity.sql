ALTER TABLE zook_bodylog_invitations ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;
CREATE TABLE IF NOT EXISTS zook_bodylog_retention_documents (
  id TEXT PRIMARY KEY,
  kind TEXT NOT NULL CHECK (kind IN ('grant','participation')),
  user_id TEXT NOT NULL REFERENCES zook_users(id) ON DELETE CASCADE,
  data JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS bodylog_retention_owner_kind ON zook_bodylog_retention_documents(user_id,kind);
