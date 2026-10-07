-- Register the BodyLog app in zook_apps.
-- BodyLog clients authenticate against the shared /api/v1/auth/* endpoints with
-- appId="bodylog" (see iOS AuthModels.swift / Android api_client). Without this
-- row every pre-auth call fails with APP_NOT_FOUND ("请求的应用不存在").
-- Idempotent: safe to replay on every deploy (CI/CD replays all migrations).
-- api_domain stays NULL so app resolution relies on the explicit body.appId,
-- matching how frogsleep/lighttick were registered.

INSERT INTO zook_apps (id, code, name, name_i18n, status, api_domain, join_mode, created_at)
VALUES (
  'bodylog',
  'bodylog',
  'BodyLog',
  '{"zh-CN": "BodyLog", "en-US": "BodyLog"}'::jsonb,
  'ACTIVE',
  NULL,
  'AUTO',
  NOW()
)
ON CONFLICT (id) DO NOTHING;

-- Heal legacy rows: some dev/integration databases carry a bodylog app created
-- manually with an invalid join_mode (e.g. 'OPEN'), which makes every
-- self-service registration fail with APP_JOIN_INVITE_REQUIRED. Only overwrite
-- values outside the JoinMode enum; an intentional INVITE_ONLY stays untouched.
UPDATE zook_apps
SET join_mode = 'AUTO'
WHERE id = 'bodylog'
  AND join_mode NOT IN ('AUTO', 'INVITE_ONLY');

-- Default/member role so AppRegistryService.assignDefaultRole can bind new signups.
INSERT INTO zook_roles (id, app_id, code, name, status)
VALUES ('role_bodylog_member', 'bodylog', 'member', 'Member', 'ACTIVE')
ON CONFLICT (app_id, code) DO NOTHING;

INSERT INTO zook_roles (id, app_id, code, name, status)
VALUES ('role_bodylog_admin', 'bodylog', 'admin', 'Admin', 'ACTIVE')
ON CONFLICT (app_id, code) DO NOTHING;

-- Explicit default role code (matches getDefaultRoleCode fallback "member").
INSERT INTO zook_app_configs (id, app_id, config_key, config_value, updated_at)
VALUES ('cfg_bodylog_default_role', 'bodylog', 'auth.default_role_code', 'member', NOW())
ON CONFLICT (app_id, config_key) DO NOTHING;
