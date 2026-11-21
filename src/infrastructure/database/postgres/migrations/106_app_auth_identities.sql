CREATE TABLE IF NOT EXISTS zook_app_auth_accounts (
  app_id TEXT NOT NULL REFERENCES zook_apps(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES zook_users(id),
  revision INTEGER NOT NULL DEFAULT 1 CHECK(revision > 0),
  phone_prompt_offered BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY(app_id,user_id)
);
CREATE TABLE IF NOT EXISTS zook_app_auth_identities (
  app_id TEXT NOT NULL REFERENCES zook_apps(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK(kind IN ('email','phone','wechat','google','apple')),
  subject TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES zook_users(id),
  status TEXT NOT NULL CHECK(status IN ('bound','released')),
  display_name TEXT,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY(app_id,kind,subject)
);
CREATE UNIQUE INDEX IF NOT EXISTS zook_app_auth_kind_owner ON zook_app_auth_identities(app_id,user_id,kind) WHERE status='bound';
CREATE TABLE IF NOT EXISTS zook_auth_identity_changes (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL REFERENCES zook_apps(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES zook_users(id),
  expires_at TIMESTAMPTZ NOT NULL,
  payload JSONB NOT NULL
);
CREATE INDEX IF NOT EXISTS zook_auth_identity_changes_expiry ON zook_auth_identity_changes(expires_at);

-- Preserve every existing app UID, including deleted memberships. Those remain
-- rejected by the existing membership guard instead of silently re-registering.
WITH initialized AS (
  INSERT INTO zook_app_auth_accounts(app_id,user_id)
  SELECT app_id,user_id FROM zook_app_users WHERE app_id='ai_novel'
  ON CONFLICT DO NOTHING RETURNING app_id,user_id
)
INSERT INTO zook_app_auth_identities(app_id,kind,subject,user_id,status)
SELECT a.app_id,identity.kind,identity.subject,u.id,'bound'
FROM initialized a JOIN zook_users u ON u.id=a.user_id
CROSS JOIN LATERAL (VALUES
  ('email',lower(nullif(trim(u.email),''))),
  ('phone',nullif(trim(u.phone),''))
) AS identity(kind,subject)
WHERE identity.subject IS NOT NULL
ON CONFLICT DO NOTHING;
