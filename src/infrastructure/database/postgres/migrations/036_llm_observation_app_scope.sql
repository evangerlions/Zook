ALTER TABLE zook_llm_call_observations
  ADD COLUMN IF NOT EXISTS app_id TEXT;

CREATE INDEX IF NOT EXISTS idx_zook_llm_observations_app_time
  ON zook_llm_call_observations(app_id, occurred_at DESC);
