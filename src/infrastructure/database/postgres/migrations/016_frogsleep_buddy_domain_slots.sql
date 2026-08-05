CREATE TABLE IF NOT EXISTS zook_frogsleep_buddy_domain_slots (
  app_id TEXT NOT NULL REFERENCES zook_apps(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES zook_users(id) ON DELETE CASCADE,
  domain TEXT NOT NULL CHECK (domain IN ('sleep', 'focus')),
  state TEXT NOT NULL CHECK (state IN ('available', 'occupied')),
  relationship_id TEXT,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (app_id, user_id, domain),
  CHECK (
    (state = 'available' AND relationship_id IS NULL)
    OR (state = 'occupied' AND relationship_id IS NOT NULL AND BTRIM(relationship_id) <> '')
  )
);

CREATE INDEX IF NOT EXISTS idx_frogsleep_buddy_domain_slots_lookup
  ON zook_frogsleep_buddy_domain_slots (app_id, user_id, domain);
