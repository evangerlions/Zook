CREATE TABLE IF NOT EXISTS zook_frogsleep_personal_sync_state (
  app_id TEXT NOT NULL REFERENCES zook_apps(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES zook_users(id) ON DELETE CASCADE,
  epoch TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  cursor_secret TEXT NOT NULL DEFAULT gen_random_uuid()::text,
  sequence BIGINT NOT NULL DEFAULT 0 CHECK(sequence >= 0),
  legacy_allowed BOOLEAN NOT NULL DEFAULT TRUE,
  deleted BOOLEAN NOT NULL DEFAULT FALSE,
  PRIMARY KEY(app_id,user_id)
);
CREATE TABLE IF NOT EXISTS zook_frogsleep_personal_versions (
  app_id TEXT NOT NULL, user_id TEXT NOT NULL, kind TEXT NOT NULL CHECK(kind IN('sleep_report','report_preferences')),
  resource_id TEXT NOT NULL, sequence BIGINT NOT NULL CHECK(sequence > 0), document JSONB NOT NULL,
  PRIMARY KEY(app_id,user_id,sequence),
  FOREIGN KEY(app_id,user_id) REFERENCES zook_frogsleep_personal_sync_state(app_id,user_id) ON DELETE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS uq_frogsleep_personal_resource_revision ON zook_frogsleep_personal_versions(app_id,user_id,kind,resource_id,((document->>'revision')::bigint));
CREATE INDEX IF NOT EXISTS idx_frogsleep_personal_history ON zook_frogsleep_personal_versions(app_id,user_id,kind,resource_id,sequence DESC);
CREATE TABLE IF NOT EXISTS zook_frogsleep_personal_receipts (
  app_id TEXT NOT NULL, user_id TEXT NOT NULL, request_key TEXT NOT NULL, digest TEXT NOT NULL, result JSONB NOT NULL,
  PRIMARY KEY(app_id,user_id,request_key),
  FOREIGN KEY(app_id,user_id) REFERENCES zook_frogsleep_personal_sync_state(app_id,user_id) ON DELETE CASCADE
);
