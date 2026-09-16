ALTER TABLE zook_ai_novel_conversation_records
  ADD COLUMN IF NOT EXISTS system_prompt TEXT,
  ADD COLUMN IF NOT EXISTS tools_json JSONB;
