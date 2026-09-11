ALTER TABLE zook_ai_novel_conversation_records
  ADD COLUMN IF NOT EXISTS message_id TEXT,
  ADD COLUMN IF NOT EXISTS session_id TEXT,
  ADD COLUMN IF NOT EXISTS turn_id TEXT;

CREATE INDEX IF NOT EXISTS idx_ai_novel_conversation_records_session
  ON zook_ai_novel_conversation_records (app_id, session_id, created_at DESC, id DESC)
  WHERE session_id IS NOT NULL;
