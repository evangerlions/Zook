CREATE TABLE IF NOT EXISTS zook_frogsleep_buddy_invitation_domain_decisions (
  app_id TEXT NOT NULL REFERENCES zook_apps(id) ON DELETE CASCADE,
  invitation_id TEXT NOT NULL,
  domain TEXT NOT NULL CHECK (domain IN ('sleep', 'focus')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled', 'expired')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  decided_by_user_id TEXT REFERENCES zook_users(id) ON DELETE SET NULL,
  decided_at TIMESTAMPTZ,
  idempotency_key_hash TEXT,
  terminal_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (app_id, invitation_id, domain)
);

CREATE INDEX IF NOT EXISTS idx_frogsleep_buddy_invitation_domain_decisions_invitation
  ON zook_frogsleep_buddy_invitation_domain_decisions (app_id, invitation_id, domain);
