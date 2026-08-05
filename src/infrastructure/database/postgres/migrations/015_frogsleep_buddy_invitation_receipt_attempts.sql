CREATE TABLE IF NOT EXISTS zook_frogsleep_buddy_invitation_receipt_attempts (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL REFERENCES zook_apps(id) ON DELETE CASCADE,
  inviter_user_id TEXT NOT NULL REFERENCES zook_users(id) ON DELETE CASCADE,
  invitee_user_id TEXT REFERENCES zook_users(id) ON DELETE SET NULL,
  recipient_identity_hash TEXT NOT NULL CHECK (recipient_identity_hash ~ '^[0-9a-f]{64}$'),
  domains TEXT[] NOT NULL,
  domains_fingerprint TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('recorded', 'decoy')),
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (app_id, inviter_user_id, recipient_identity_hash, domains_fingerprint),
  CHECK (cardinality(domains) BETWEEN 1 AND 2),
  CHECK (domains <@ ARRAY['sleep', 'focus']::TEXT[]),
  CHECK (cardinality(domains) = 1 OR (
    array_position(domains, 'sleep') IS NOT NULL AND array_position(domains, 'focus') IS NOT NULL
  ))
);

CREATE INDEX IF NOT EXISTS idx_frogsleep_buddy_invitation_receipt_attempts_outbox
  ON zook_frogsleep_buddy_invitation_receipt_attempts (app_id, inviter_user_id, created_at DESC, id DESC);
