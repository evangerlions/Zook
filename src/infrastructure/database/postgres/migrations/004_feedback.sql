CREATE TABLE IF NOT EXISTS zook_feedback (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL REFERENCES zook_apps(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES zook_users(id) ON DELETE CASCADE,
  message TEXT NOT NULL,
  message_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new', 'doing', 'done')),
  platform TEXT,
  app_version TEXT,
  locale TEXT,
  ip_hash TEXT,
  user_agent TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  attachment_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_zook_feedback_app_created
  ON zook_feedback(app_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_zook_feedback_user_created
  ON zook_feedback(app_id, user_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_zook_feedback_ip_created
  ON zook_feedback(app_id, ip_hash, created_at DESC)
  WHERE ip_hash IS NOT NULL;

CREATE TABLE IF NOT EXISTS zook_feedback_attachments (
  id TEXT PRIMARY KEY,
  feedback_id TEXT NOT NULL REFERENCES zook_feedback(id) ON DELETE CASCADE,
  app_id TEXT NOT NULL REFERENCES zook_apps(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES zook_users(id) ON DELETE CASCADE,
  file_name TEXT NOT NULL,
  mime_type TEXT NOT NULL,
  size_bytes INTEGER NOT NULL,
  width INTEGER,
  height INTEGER,
  storage_path TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_zook_feedback_attachments_feedback
  ON zook_feedback_attachments(feedback_id, created_at ASC);
