-- Preserve date-only schedules independently of timestamp/timezone conversion.
ALTER TABLE zook_lighttick_tasks ADD COLUMN IF NOT EXISTS scheduled_business_date VARCHAR(10)
  CHECK (scheduled_business_date ~ '^\d{4}-\d{2}-\d{2}$');
