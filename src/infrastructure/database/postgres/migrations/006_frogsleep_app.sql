CREATE TABLE IF NOT EXISTS zook_frogsleep_devices (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL REFERENCES zook_apps(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES zook_users(id) ON DELETE CASCADE,
  platform TEXT NOT NULL CHECK (platform IN ('ios', 'android', 'web')),
  push_token TEXT NOT NULL,
  app_version TEXT,
  timezone TEXT,
  push_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (app_id, user_id, push_token)
);

CREATE INDEX IF NOT EXISTS idx_frogsleep_devices_user
  ON zook_frogsleep_devices (app_id, user_id)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_frogsleep_devices_push
  ON zook_frogsleep_devices (app_id, user_id, push_enabled)
  WHERE deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS zook_frogsleep_sleep_invites (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL REFERENCES zook_apps(id) ON DELETE CASCADE,
  owner_user_id TEXT REFERENCES zook_users(id) ON DELETE CASCADE,
  partner_user_id TEXT REFERENCES zook_users(id) ON DELETE CASCADE,
  relationship_id TEXT,
  session_id TEXT,
  status TEXT,
  code TEXT,
  token TEXT,
  starts_at TIMESTAMPTZ,
  ends_at TIMESTAMPTZ,
  occurred_at TIMESTAMPTZ,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  deleted_at TIMESTAMPTZ,
  UNIQUE (app_id, code),
  UNIQUE (app_id, token)
);

CREATE TABLE IF NOT EXISTS zook_frogsleep_sleep_relationships (LIKE zook_frogsleep_sleep_invites INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES);
CREATE TABLE IF NOT EXISTS zook_frogsleep_guardianship_preferences (LIKE zook_frogsleep_sleep_invites INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES);
CREATE TABLE IF NOT EXISTS zook_frogsleep_sleep_sessions (LIKE zook_frogsleep_sleep_invites INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES);
CREATE TABLE IF NOT EXISTS zook_frogsleep_sleep_events (LIKE zook_frogsleep_sleep_invites INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES);
CREATE TABLE IF NOT EXISTS zook_frogsleep_sleep_summaries (LIKE zook_frogsleep_sleep_invites INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES);
CREATE TABLE IF NOT EXISTS zook_frogsleep_night_recaps (LIKE zook_frogsleep_sleep_invites INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES);
CREATE TABLE IF NOT EXISTS zook_frogsleep_focus_profiles (LIKE zook_frogsleep_sleep_invites INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES);
CREATE TABLE IF NOT EXISTS zook_frogsleep_focus_relationships (LIKE zook_frogsleep_sleep_invites INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES);
CREATE TABLE IF NOT EXISTS zook_frogsleep_focus_invites (LIKE zook_frogsleep_sleep_invites INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES);
CREATE TABLE IF NOT EXISTS zook_frogsleep_focus_sessions (LIKE zook_frogsleep_sleep_invites INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES);
CREATE TABLE IF NOT EXISTS zook_frogsleep_focus_shared_moments (LIKE zook_frogsleep_sleep_invites INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES);
CREATE TABLE IF NOT EXISTS zook_frogsleep_focus_messages (LIKE zook_frogsleep_sleep_invites INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES);
CREATE TABLE IF NOT EXISTS zook_frogsleep_focus_milestones (LIKE zook_frogsleep_sleep_invites INCLUDING DEFAULTS INCLUDING CONSTRAINTS INCLUDING INDEXES);

CREATE INDEX IF NOT EXISTS idx_frogsleep_sleep_invites_owner ON zook_frogsleep_sleep_invites (app_id, owner_user_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_frogsleep_sleep_relationships_owner ON zook_frogsleep_sleep_relationships (app_id, owner_user_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_frogsleep_guardianship_preferences_relationship ON zook_frogsleep_guardianship_preferences (app_id, relationship_id, owner_user_id) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_frogsleep_sleep_sessions_relationship ON zook_frogsleep_sleep_sessions (app_id, relationship_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_frogsleep_sleep_events_session ON zook_frogsleep_sleep_events (app_id, session_id, occurred_at) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_frogsleep_sleep_summaries_owner ON zook_frogsleep_sleep_summaries (app_id, owner_user_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_frogsleep_night_recaps_relationship ON zook_frogsleep_night_recaps (app_id, relationship_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_frogsleep_focus_profiles_owner ON zook_frogsleep_focus_profiles (app_id, owner_user_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_frogsleep_focus_relationships_owner ON zook_frogsleep_focus_relationships (app_id, owner_user_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_frogsleep_focus_invites_owner ON zook_frogsleep_focus_invites (app_id, owner_user_id, status) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_frogsleep_focus_sessions_owner ON zook_frogsleep_focus_sessions (app_id, owner_user_id, starts_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_frogsleep_focus_shared_moments_relationship ON zook_frogsleep_focus_shared_moments (app_id, relationship_id, starts_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_frogsleep_focus_messages_relationship ON zook_frogsleep_focus_messages (app_id, relationship_id, created_at DESC) WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_frogsleep_focus_milestones_owner ON zook_frogsleep_focus_milestones (app_id, owner_user_id, status) WHERE deleted_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_frogsleep_sleep_relationships_live_pair_uidx
  ON zook_frogsleep_sleep_relationships (
    app_id,
    LEAST(owner_user_id, partner_user_id),
    GREATEST(owner_user_id, partner_user_id)
  )
  WHERE deleted_at IS NULL
    AND owner_user_id IS NOT NULL
    AND partner_user_id IS NOT NULL
    AND status IN ('active', 'paused');

CREATE UNIQUE INDEX IF NOT EXISTS idx_frogsleep_focus_relationships_live_pair_uidx
  ON zook_frogsleep_focus_relationships (
    app_id,
    LEAST(owner_user_id, partner_user_id),
    GREATEST(owner_user_id, partner_user_id)
  )
  WHERE deleted_at IS NULL
    AND owner_user_id IS NOT NULL
    AND partner_user_id IS NOT NULL
    AND status IN ('pending', 'accepted');
