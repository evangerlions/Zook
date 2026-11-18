-- 学习笔记表
CREATE TABLE IF NOT EXISTS zook_lighttick_study_notes (
  app_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  course_id TEXT NOT NULL,
  notes TEXT NOT NULL DEFAULT '',
  answers JSONB NOT NULL DEFAULT '{}',
  revision INTEGER NOT NULL DEFAULT 1,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (app_id, user_id, kind, course_id)
);

CREATE INDEX IF NOT EXISTS idx_study_notes_updated ON zook_lighttick_study_notes(app_id, user_id, updated_at DESC);

-- 学习记录表
CREATE TABLE IF NOT EXISTS zook_lighttick_learning_records (
  app_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  module_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  lesson_no INTEGER NOT NULL,
  topic TEXT NOT NULL,
  summary_text TEXT NOT NULL DEFAULT '',
  time_spent_seconds INTEGER NOT NULL DEFAULT 0,
  completed_at TIMESTAMPTZ NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  revision INTEGER NOT NULL DEFAULT 1,
  PRIMARY KEY (app_id, user_id, module_id, filename)
);

CREATE INDEX IF NOT EXISTS idx_learning_records_completed ON zook_lighttick_learning_records(app_id, user_id, completed_at DESC);
