CREATE TABLE IF NOT EXISTS zook_lighttick_learning_continuations (
  app_id TEXT NOT NULL CHECK (app_id = 'lighttick'),
  user_id TEXT NOT NULL,
  task_id TEXT NOT NULL REFERENCES zook_lighttick_tasks(id) ON DELETE CASCADE,
  scheduled_date DATE NOT NULL,
  due_date DATE NOT NULL,
  phase TEXT NOT NULL CHECK (phase IN ('rollover', 'reminder', 'enqueued', 'finished', 'adjustment')),
  reminder_time TIME,
  moved_version INTEGER CHECK (moved_version > 0),
  adjustment_reason TEXT,
  PRIMARY KEY (app_id, user_id, task_id)
);

CREATE INDEX IF NOT EXISTS zook_lighttick_learning_continuations_due_idx
  ON zook_lighttick_learning_continuations (due_date, app_id, user_id, task_id)
  WHERE phase IN ('rollover', 'reminder');
