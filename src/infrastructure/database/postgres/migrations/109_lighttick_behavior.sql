-- LightTick 行为应用追踪表
CREATE TABLE IF NOT EXISTS zook_lighttick_behavior_applications (
  app_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  id TEXT NOT NULL,
  date DATE NOT NULL,
  module_id TEXT NOT NULL,
  concept TEXT NOT NULL,
  scenario TEXT DEFAULT '',
  effectiveness INTEGER DEFAULT 0,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (app_id, user_id, id)
);

CREATE INDEX IF NOT EXISTS idx_behavior_app_date ON zook_lighttick_behavior_applications(app_id, user_id, date);
CREATE INDEX IF NOT EXISTS idx_behavior_app_module ON zook_lighttick_behavior_applications(app_id, user_id, module_id);
