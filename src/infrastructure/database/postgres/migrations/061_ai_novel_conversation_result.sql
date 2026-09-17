ALTER TABLE zook_ai_novel_conversation_records
  ADD COLUMN IF NOT EXISTS outcome TEXT NOT NULL DEFAULT 'success',
  ADD COLUMN IF NOT EXISTS error_code TEXT,
  ADD COLUMN IF NOT EXISTS error_message TEXT,
  ADD COLUMN IF NOT EXISTS server_compacted BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE zook_ai_novel_conversation_records
SET outcome = 'success'
WHERE outcome IS NULL OR outcome NOT IN ('success', 'failure');

ALTER TABLE zook_ai_novel_conversation_records
  DROP CONSTRAINT IF EXISTS ai_novel_conversation_records_outcome_check,
  ADD CONSTRAINT ai_novel_conversation_records_outcome_check
    CHECK (outcome IN ('success', 'failure'));
