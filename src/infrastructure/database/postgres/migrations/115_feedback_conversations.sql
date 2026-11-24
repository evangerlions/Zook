ALTER TABLE zook_feedback
  ADD COLUMN IF NOT EXISTS conversation_updated_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS needs_reply BOOLEAN NOT NULL DEFAULT TRUE,
  ADD COLUMN IF NOT EXISTS last_support_message BIGINT NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS read_support_message BIGINT NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_zook_feedback_owner_activity
  ON zook_feedback(app_id, user_id, (COALESCE(conversation_updated_at, created_at)) DESC, id DESC);

CREATE TABLE IF NOT EXISTS zook_feedback_replies (
  id TEXT PRIMARY KEY,
  feedback_id TEXT NOT NULL REFERENCES zook_feedback(id) ON DELETE CASCADE,
  sequence BIGINT GENERATED ALWAYS AS IDENTITY,
  sender TEXT NOT NULL CHECK (sender IN ('user', 'support')),
  message TEXT NOT NULL,
  submission_key TEXT NOT NULL,
  fingerprint TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE(feedback_id, sender, submission_key)
);

CREATE INDEX IF NOT EXISTS idx_zook_feedback_replies_thread
  ON zook_feedback_replies(feedback_id, sequence DESC);

ALTER TABLE zook_feedback_attachments
  ADD COLUMN IF NOT EXISTS reply_id TEXT REFERENCES zook_feedback_replies(id) ON DELETE CASCADE;

CREATE INDEX IF NOT EXISTS idx_zook_feedback_attachments_reply
  ON zook_feedback_attachments(reply_id, id) WHERE reply_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_zook_feedback_attachments_storage
  ON zook_feedback_attachments(app_id, storage_path);
