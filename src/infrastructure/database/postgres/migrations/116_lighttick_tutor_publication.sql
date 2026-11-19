ALTER TABLE zook_lighttick_lesson_publications
  ADD COLUMN IF NOT EXISTS tutor_topic TEXT;

ALTER TABLE zook_lighttick_learning_authorities
  ADD COLUMN IF NOT EXISTS consent_revision INTEGER NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS lighttick_tutor_work_lesson
  ON zook_lighttick_learning_work(app_id, user_id, (payload->'input'->>'lesson_id'),
    (payload->'input'->>'content_version'), created_at, id)
  WHERE payload->>'kind' = 'tutor_turn';
