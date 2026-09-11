-- Phase 2: evidence-driven execution DNA. Append-only audit trail for every
-- factual feedback and rule output so insights can be traced back to inputs.
CREATE TABLE IF NOT EXISTS zook_lighttick_insight_audits (
  id TEXT PRIMARY KEY, app_id TEXT NOT NULL, user_id TEXT NOT NULL,
  rule_id TEXT NOT NULL, kind TEXT NOT NULL
    CHECK (kind IN ('factual', 'hypothesis', 'rule')),
  evidence_count INTEGER NOT NULL CHECK (evidence_count >= 0),
  evidence_window JSONB NOT NULL DEFAULT '{}'::jsonb,
  output JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS zook_lighttick_insight_audits_owner_time_idx
  ON zook_lighttick_insight_audits (app_id, user_id, created_at DESC);
