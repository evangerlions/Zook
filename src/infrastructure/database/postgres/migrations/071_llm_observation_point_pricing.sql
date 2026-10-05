ALTER TABLE zook_llm_call_observations
  ADD COLUMN IF NOT EXISTS point_micros NUMERIC(38, 0),
  ADD COLUMN IF NOT EXISTS input_points_per_million_tokens BIGINT,
  ADD COLUMN IF NOT EXISTS output_points_per_million_tokens BIGINT;
