-- Keep numeric evidence rather than inferring bias from localized statements.
-- Historical insights without evidence must not issue directional advice.
ALTER TABLE zook_lighttick_dna_insights
  ADD COLUMN IF NOT EXISTS evidence JSONB NOT NULL DEFAULT '{}'::jsonb;
