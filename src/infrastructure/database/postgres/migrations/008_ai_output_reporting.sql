CREATE TABLE IF NOT EXISTS zook_ai_output_reports (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL,
  app_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type IN ('chat_message', 'chapter_revision')),
  target_id TEXT NOT NULL,
  message_id TEXT,
  session_id TEXT,
  chapter_id INTEGER,
  chapter_revision_id TEXT,
  scene TEXT NOT NULL CHECK (scene IN ('kickoff', 'write', 'history_qa')),
  category TEXT NOT NULL CHECK (
    category IN (
      'harmful_unsafe',
      'sexual_vulgar',
      'abuse_harassment',
      'illegal_crime',
      'privacy_personal_info',
      'misinformation',
      'rights_infringement',
      'other'
    )
  ),
  description TEXT,
  encrypted_content_key_id TEXT NOT NULL,
  encrypted_content_algorithm TEXT NOT NULL,
  encrypted_content_nonce_base64 TEXT NOT NULL,
  encrypted_content_ciphertext_base64 TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  turn_id TEXT,
  provider_request_id TEXT,
  model_key TEXT,
  client_region TEXT,
  account_region TEXT NOT NULL,
  effective_region TEXT,
  platform TEXT,
  app_version TEXT,
  locale TEXT,
  status TEXT NOT NULL CHECK (status IN ('received', 'reviewing', 'resolved', 'rejected')),
  resolution_code TEXT,
  resolution_note TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL,
  resolved_at TIMESTAMPTZ,
  UNIQUE (app_id, user_id, submission_id)
);

CREATE INDEX IF NOT EXISTS idx_zook_ai_output_reports_review
  ON zook_ai_output_reports(app_id, status, category, created_at DESC);

CREATE TABLE IF NOT EXISTS zook_ai_output_reactions (
  id TEXT PRIMARY KEY,
  submission_id TEXT NOT NULL,
  app_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  target_type TEXT NOT NULL CHECK (target_type = 'chapter_revision'),
  target_id TEXT NOT NULL,
  reaction TEXT NOT NULL CHECK (reaction = 'like'),
  chapter_id INTEGER NOT NULL,
  chapter_revision_id TEXT NOT NULL,
  content_hash TEXT NOT NULL,
  turn_id TEXT,
  provider_request_id TEXT,
  platform TEXT,
  app_version TEXT,
  effective_region TEXT,
  created_at TIMESTAMPTZ NOT NULL,
  UNIQUE (app_id, user_id, submission_id)
);

CREATE INDEX IF NOT EXISTS idx_zook_ai_output_reactions_target
  ON zook_ai_output_reactions(app_id, target_id, created_at DESC);
