-- NULL preserves existing/normal calls; historical moderation cannot be inferred
-- safely from model identity or response mode.
ALTER TABLE zook_llm_call_observations
  ADD COLUMN IF NOT EXISTS call_purpose TEXT;
