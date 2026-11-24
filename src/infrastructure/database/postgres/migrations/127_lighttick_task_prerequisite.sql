ALTER TABLE zook_lighttick_tasks
  ADD COLUMN IF NOT EXISTS prerequisite_task_id text CHECK (prerequisite_task_id <> id);
