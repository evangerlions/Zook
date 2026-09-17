ALTER TABLE zook_ai_novel_conversation_records
  ADD COLUMN IF NOT EXISTS prompt_tokens INTEGER NOT NULL DEFAULT -1,
  ADD COLUMN IF NOT EXISTS completion_tokens INTEGER NOT NULL DEFAULT -1,
  ADD COLUMN IF NOT EXISTS total_tokens INTEGER NOT NULL DEFAULT -1,
  ADD COLUMN IF NOT EXISTS reasoning_tokens INTEGER NOT NULL DEFAULT -1,
  ADD COLUMN IF NOT EXISTS usage_source TEXT NOT NULL DEFAULT 'missing';

UPDATE zook_ai_novel_conversation_records
SET usage_source = 'missing'
WHERE usage_source IS NULL OR usage_source NOT IN ('provider', 'missing');

ALTER TABLE zook_ai_novel_conversation_records
  DROP CONSTRAINT IF EXISTS ai_novel_conversation_records_usage_source_check,
  ADD CONSTRAINT ai_novel_conversation_records_usage_source_check
    CHECK (usage_source IN ('provider', 'missing'));
