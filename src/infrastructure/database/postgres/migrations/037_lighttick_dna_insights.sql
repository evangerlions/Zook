-- Phase 2 W11-15: execution DNA insights. Promoted from deterministic rule
-- outputs; low-confidence insights never gain allowed_effects. User feedback
-- (confirm/deny/correct) is the only way to grant effects; dismiss retires a
-- suggestion from the Today rhythm feed without judging its truth.
CREATE TABLE IF NOT EXISTS zook_lighttick_dna_insights (
  id TEXT PRIMARY KEY, app_id TEXT NOT NULL, user_id TEXT NOT NULL,
  signature TEXT NOT NULL,
  rule_id TEXT NOT NULL,
  statement TEXT NOT NULL CHECK (length(statement) BETWEEN 1 AND 1000),
  kind TEXT NOT NULL CHECK (kind IN ('hypothesis', 'rule')),
  status TEXT NOT NULL CHECK (status IN ('proposed', 'confirmed', 'denied', 'corrected', 'expired', 'dismissed')),
  evidence_count INTEGER NOT NULL CHECK (evidence_count >= 0),
  data_range JSONB NOT NULL DEFAULT '{}'::jsonb,
  confidence REAL NOT NULL CHECK (confidence >= 0 AND confidence <= 1),
  scope TEXT NOT NULL,
  allowed_effects JSONB NOT NULL DEFAULT '[]'::jsonb,
  user_feedback TEXT,
  goal_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  expires_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  UNIQUE (app_id, user_id, signature)
);
CREATE INDEX IF NOT EXISTS zook_lighttick_dna_insights_owner_status_idx
  ON zook_lighttick_dna_insights (app_id, user_id, status, updated_at DESC);
