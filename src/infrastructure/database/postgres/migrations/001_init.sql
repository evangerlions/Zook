-- Canonical runtime schema for the pre-launch PostgreSQL backend.
-- Keep every statement idempotent:
--   - CREATE ... IF NOT EXISTS
--   - CREATE INDEX ... IF NOT EXISTS

CREATE TABLE IF NOT EXISTS zook_schema_migrations (
  name TEXT PRIMARY KEY,
  checksum TEXT,
  applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS zook_apps (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  name_i18n JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL,
  api_domain TEXT,
  join_mode TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS zook_apps_code_uidx ON zook_apps (code);
CREATE UNIQUE INDEX IF NOT EXISTS zook_apps_api_domain_uidx ON zook_apps (api_domain) WHERE api_domain IS NOT NULL;

CREATE TABLE IF NOT EXISTS zook_users (
  id TEXT PRIMARY KEY,
  email TEXT,
  phone TEXT,
  password_hash TEXT NOT NULL,
  password_algo TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS zook_users_email_uidx ON zook_users (lower(email)) WHERE email IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS zook_users_phone_uidx ON zook_users (lower(phone)) WHERE phone IS NOT NULL;

CREATE TABLE IF NOT EXISTS zook_app_users (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  status TEXT NOT NULL,
  joined_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS zook_app_users_app_user_uidx ON zook_app_users (app_id, user_id);
CREATE INDEX IF NOT EXISTS zook_app_users_app_joined_idx ON zook_app_users (app_id, joined_at DESC);

CREATE TABLE IF NOT EXISTS zook_roles (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS zook_roles_app_code_uidx ON zook_roles (app_id, code);

CREATE TABLE IF NOT EXISTS zook_permissions (
  id TEXT PRIMARY KEY,
  code TEXT NOT NULL,
  name TEXT NOT NULL,
  status TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS zook_permissions_code_uidx ON zook_permissions (code);

CREATE TABLE IF NOT EXISTS zook_role_permissions (
  id TEXT PRIMARY KEY,
  role_id TEXT NOT NULL,
  permission_id TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS zook_role_permissions_role_permission_uidx
  ON zook_role_permissions (role_id, permission_id);

CREATE TABLE IF NOT EXISTS zook_user_roles (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role_id TEXT NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS zook_user_roles_app_user_role_uidx
  ON zook_user_roles (app_id, user_id, role_id);
CREATE INDEX IF NOT EXISTS zook_user_roles_app_user_idx ON zook_user_roles (app_id, user_id);

CREATE TABLE IF NOT EXISTS zook_audit_logs (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL,
  actor_user_id TEXT,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  resource_owner_user_id TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS zook_audit_logs_app_created_idx ON zook_audit_logs (app_id, created_at DESC);

CREATE TABLE IF NOT EXISTS zook_notification_jobs (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL,
  recipient_user_id TEXT NOT NULL,
  channel TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL,
  retry_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS zook_notification_jobs_app_status_idx ON zook_notification_jobs (app_id, status);

CREATE TABLE IF NOT EXISTS zook_failed_events (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  error_message TEXT NOT NULL DEFAULT '',
  retry_count INTEGER NOT NULL DEFAULT 0,
  next_retry_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS zook_failed_events_retry_idx ON zook_failed_events (next_retry_at ASC);

CREATE TABLE IF NOT EXISTS zook_app_configs (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL,
  config_key TEXT NOT NULL,
  config_value TEXT NOT NULL DEFAULT '',
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS zook_app_configs_app_key_uidx ON zook_app_configs (app_id, config_key);

CREATE TABLE IF NOT EXISTS zook_analytics_events (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  platform TEXT NOT NULL,
  session_id TEXT NOT NULL,
  page_key TEXT NOT NULL,
  event_name TEXT NOT NULL,
  duration_ms INTEGER,
  occurred_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS zook_analytics_events_app_occurred_idx
  ON zook_analytics_events (app_id, occurred_at DESC);

CREATE TABLE IF NOT EXISTS zook_files (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL,
  owner_user_id TEXT NOT NULL,
  storage_key TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes BIGINT NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS zook_files_app_storage_uidx ON zook_files (app_id, storage_key);

CREATE TABLE IF NOT EXISTS zook_client_log_upload_tasks (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL,
  user_id TEXT,
  did TEXT,
  key_id TEXT NOT NULL,
  from_ts_ms BIGINT,
  to_ts_ms BIGINT,
  max_lines INTEGER,
  max_bytes INTEGER,
  status TEXT NOT NULL,
  claim_token TEXT,
  claim_expire_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ,
  uploaded_at TIMESTAMPTZ,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
ALTER TABLE zook_client_log_upload_tasks ADD COLUMN IF NOT EXISTS did TEXT;
ALTER TABLE zook_client_log_upload_tasks ADD COLUMN IF NOT EXISTS client_id TEXT;
UPDATE zook_client_log_upload_tasks
SET did = client_id
WHERE did IS NULL
  AND client_id IS NOT NULL;
ALTER TABLE zook_client_log_upload_tasks ADD COLUMN IF NOT EXISTS claim_token TEXT;
ALTER TABLE zook_client_log_upload_tasks ADD COLUMN IF NOT EXISTS claim_expire_at TIMESTAMPTZ;
CREATE INDEX IF NOT EXISTS zook_client_log_upload_tasks_app_created_idx
  ON zook_client_log_upload_tasks (app_id, created_at DESC);

CREATE TABLE IF NOT EXISTS zook_client_log_uploads (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  app_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  key_id TEXT NOT NULL,
  encryption TEXT NOT NULL,
  content_encoding TEXT NOT NULL,
  nonce_base64 TEXT NOT NULL,
  line_count_reported INTEGER,
  plain_bytes_reported INTEGER,
  compressed_bytes_reported INTEGER,
  encrypted_bytes INTEGER NOT NULL DEFAULT 0,
  accepted_count INTEGER NOT NULL DEFAULT 0,
  rejected_count INTEGER NOT NULL DEFAULT 0,
  uploaded_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS zook_client_log_uploads_task_idx ON zook_client_log_uploads (task_id);

CREATE TABLE IF NOT EXISTS zook_client_log_lines (
  id TEXT PRIMARY KEY,
  upload_id TEXT NOT NULL,
  task_id TEXT NOT NULL,
  app_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  timestamp_ms BIGINT,
  level TEXT,
  message TEXT,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS zook_client_log_lines_upload_idx ON zook_client_log_lines (upload_id);
