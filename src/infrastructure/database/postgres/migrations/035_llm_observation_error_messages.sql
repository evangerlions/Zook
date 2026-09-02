ALTER TABLE zook_llm_call_observations
  ADD COLUMN IF NOT EXISTS error_message TEXT;
