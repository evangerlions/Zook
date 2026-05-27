CREATE TABLE IF NOT EXISTS zook_content_safety_checks (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL,
  user_id TEXT,
  request_id TEXT,
  task_type TEXT,
  source TEXT NOT NULL,
  method TEXT NOT NULL,
  decision TEXT NOT NULL,
  category TEXT,
  keyword_id TEXT,
  blocked_text TEXT,
  text_length INTEGER NOT NULL,
  text_hash TEXT NOT NULL,
  latency_ms INTEGER,
  model_key TEXT,
  provider TEXT,
  provider_model TEXT,
  failure_reason TEXT,
  failure_detail TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS zook_content_safety_checks_created_idx
  ON zook_content_safety_checks (created_at DESC);

CREATE INDEX IF NOT EXISTS zook_content_safety_checks_app_created_idx
  ON zook_content_safety_checks (app_id, created_at DESC);

CREATE INDEX IF NOT EXISTS zook_content_safety_checks_decision_created_idx
  ON zook_content_safety_checks (decision, created_at DESC);
