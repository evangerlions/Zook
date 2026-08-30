CREATE SEQUENCE IF NOT EXISTS zook_lighttick_change_sequence;

CREATE TABLE IF NOT EXISTS zook_lighttick_change_log (
  sequence BIGINT PRIMARY KEY DEFAULT nextval('zook_lighttick_change_sequence'),
  app_id TEXT NOT NULL, user_id TEXT NOT NULL, entity_type TEXT NOT NULL, entity_id TEXT NOT NULL,
  entity_version INTEGER NOT NULL CHECK (entity_version > 0), operation TEXT NOT NULL,
  snapshot JSONB, changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS zook_lighttick_changes_owner_sequence_idx
  ON zook_lighttick_change_log (app_id, user_id, sequence);

CREATE TABLE IF NOT EXISTS zook_lighttick_operations (
  app_id TEXT NOT NULL, user_id TEXT NOT NULL, operation_id TEXT NOT NULL,
  device_id TEXT NOT NULL, payload_hash TEXT NOT NULL, entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL, action TEXT NOT NULL, request_payload JSONB NOT NULL,
  result_payload JSONB NOT NULL, status TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (app_id, user_id, operation_id)
);
CREATE INDEX IF NOT EXISTS zook_lighttick_operations_owner_created_idx
  ON zook_lighttick_operations (app_id, user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS zook_lighttick_sync_cursors (
  id TEXT PRIMARY KEY, app_id TEXT NOT NULL, user_id TEXT NOT NULL,
  last_sequence BIGINT NOT NULL DEFAULT 0 CHECK (last_sequence >= 0),
  expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS zook_lighttick_cursors_owner_idx
  ON zook_lighttick_sync_cursors (app_id, user_id, expires_at);

CREATE TABLE IF NOT EXISTS zook_lighttick_devices (
  id TEXT NOT NULL, app_id TEXT NOT NULL, user_id TEXT NOT NULL,
  platform TEXT NOT NULL, push_provider TEXT NOT NULL, push_token TEXT NOT NULL,
  timezone TEXT NOT NULL, locale TEXT NOT NULL, app_version TEXT NOT NULL,
  notifications_enabled BOOLEAN NOT NULL DEFAULT TRUE, active BOOLEAN NOT NULL DEFAULT TRUE,
  deleted_at TIMESTAMPTZ, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), PRIMARY KEY (app_id, user_id, id)
);
CREATE UNIQUE INDEX IF NOT EXISTS zook_lighttick_devices_active_token_uidx
  ON zook_lighttick_devices (app_id, push_provider, push_token) WHERE active AND deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS zook_lighttick_devices_owner_active_idx
  ON zook_lighttick_devices (app_id, user_id, active, updated_at DESC);
