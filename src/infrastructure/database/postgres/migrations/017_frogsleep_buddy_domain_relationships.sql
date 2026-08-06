CREATE TABLE IF NOT EXISTS zook_frogsleep_buddy_domain_relationships (
  id TEXT PRIMARY KEY CHECK (BTRIM(id) <> ''),
  app_id TEXT NOT NULL REFERENCES zook_apps(id) ON DELETE CASCADE,
  domain TEXT NOT NULL CHECK (domain IN ('sleep', 'focus')),
  user_id_low TEXT NOT NULL REFERENCES zook_users(id) ON DELETE CASCADE,
  user_id_high TEXT NOT NULL REFERENCES zook_users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('active', 'paused', 'revoked')),
  paused_by_user_ids TEXT[] NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1 CHECK (version >= 1),
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (BTRIM(user_id_low) <> '' AND BTRIM(user_id_high) <> '' AND user_id_low < user_id_high),
  CHECK (paused_by_user_ids <@ ARRAY[user_id_low, user_id_high]),
  CHECK (array_position(paused_by_user_ids, NULL) IS NULL),
  CHECK (cardinality(paused_by_user_ids) <= 2),
  CHECK (cardinality(paused_by_user_ids) < 2 OR paused_by_user_ids[1] < paused_by_user_ids[2]),
  CHECK (
    (status = 'active' AND cardinality(paused_by_user_ids) = 0 AND revoked_at IS NULL)
    OR (status = 'paused' AND cardinality(paused_by_user_ids) > 0 AND revoked_at IS NULL)
    OR (status = 'revoked' AND cardinality(paused_by_user_ids) = 0 AND revoked_at IS NOT NULL)
  )
);

CREATE UNIQUE INDEX IF NOT EXISTS uq_frogsleep_buddy_domain_relationships_current_pair
  ON zook_frogsleep_buddy_domain_relationships (app_id, domain, user_id_low, user_id_high)
  WHERE status IN ('active', 'paused');

CREATE INDEX IF NOT EXISTS idx_frogsleep_buddy_domain_relationships_low
  ON zook_frogsleep_buddy_domain_relationships (app_id, user_id_low, domain, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_frogsleep_buddy_domain_relationships_high
  ON zook_frogsleep_buddy_domain_relationships (app_id, user_id_high, domain, status, updated_at DESC);

CREATE INDEX IF NOT EXISTS idx_frogsleep_buddy_domain_relationships_domain_status
  ON zook_frogsleep_buddy_domain_relationships (app_id, domain, status, updated_at DESC);
