-- AI 证据面板表
CREATE TABLE IF NOT EXISTS zook_lighttick_ai_evidence (
  app_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  id TEXT NOT NULL,
  kind TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  stage TEXT NOT NULL,
  model TEXT NOT NULL,
  data JSONB NOT NULL,
  captured_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (app_id, user_id, id)
);

CREATE TABLE IF NOT EXISTS zook_lighttick_ai_evidence_feedback (
  app_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  snapshot_id TEXT NOT NULL,
  useful BOOLEAN NOT NULL,
  comment TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (app_id, user_id, snapshot_id)
);
