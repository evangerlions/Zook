ALTER TABLE zook_feedback
  ALTER COLUMN status SET DEFAULT 'new';

ALTER TABLE zook_feedback
  DROP CONSTRAINT IF EXISTS zook_feedback_status_check;

UPDATE zook_feedback
SET status = 'new'
WHERE status = 'OPEN';

UPDATE zook_feedback
SET status = 'done'
WHERE status = 'ARCHIVED';

UPDATE zook_feedback
SET status = 'new'
WHERE status NOT IN ('new', 'doing', 'done');

ALTER TABLE zook_feedback
  ADD CONSTRAINT zook_feedback_status_check
  CHECK (status IN ('new', 'doing', 'done'));
