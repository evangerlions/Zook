-- Report practice reuses durable learning work and its existing owner deletion path.
CREATE INDEX IF NOT EXISTS zook_lighttick_report_practice_lookup
ON zook_lighttick_learning_work(app_id,user_id,(payload->'input'->>'lesson_id'),(payload->'input'->>'content_version'),created_at,id)
WHERE payload->>'kind'='report_review';
