-- Phase 2 W9-10: AI Coach multi-turn conversation persistence. Threads are
-- per goal by default; raw coach text lives only here and in ai_runs, and is
-- never copied into insight audits or ordinary telemetry.
CREATE TABLE IF NOT EXISTS zook_lighttick_chat_messages (
  id TEXT PRIMARY KEY, app_id TEXT NOT NULL, user_id TEXT NOT NULL,
  thread_id TEXT NOT NULL, goal_id TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('user', 'assistant')),
  content TEXT NOT NULL CHECK (length(content) BETWEEN 1 AND 4000),
  run_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS zook_lighttick_chat_thread_time_idx
  ON zook_lighttick_chat_messages (app_id, user_id, thread_id, created_at DESC);
CREATE INDEX IF NOT EXISTS zook_lighttick_chat_goal_time_idx
  ON zook_lighttick_chat_messages (app_id, user_id, goal_id, created_at DESC);
