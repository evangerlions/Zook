CREATE TABLE IF NOT EXISTS zook_ai_novel_conversation_records (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL REFERENCES zook_apps(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL,
  did TEXT,
  request_id TEXT NOT NULL,
  scene_key TEXT NOT NULL,
  user_text TEXT NOT NULL,
  assistant_text TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_ai_novel_conversation_records_request
  ON zook_ai_novel_conversation_records (app_id, user_id, request_id);
CREATE INDEX IF NOT EXISTS idx_ai_novel_conversation_records_user_latest
  ON zook_ai_novel_conversation_records (app_id, user_id, created_at DESC, id DESC);
CREATE INDEX IF NOT EXISTS idx_ai_novel_conversation_records_did_latest
  ON zook_ai_novel_conversation_records (app_id, did, created_at DESC, id DESC)
  WHERE did IS NOT NULL;
