ALTER TABLE zook_llm_call_observations
  ADD COLUMN IF NOT EXISTS cached_input_tokens BIGINT,
  ADD COLUMN IF NOT EXISTS cached_input_points_per_million_tokens BIGINT,
  ADD COLUMN IF NOT EXISTS point_pricing JSONB;
