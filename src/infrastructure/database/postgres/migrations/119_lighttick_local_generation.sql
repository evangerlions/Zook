ALTER TABLE zook_lighttick_learning_authorities
  ADD COLUMN IF NOT EXISTS consent_revision integer NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS zook_lighttick_local_generations (
  app_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('prepared','succeeded','cancelled','expired','rejected')),
  payload JSONB NOT NULL,
  PRIMARY KEY (app_id,user_id,id)
);

CREATE INDEX IF NOT EXISTS idx_lighttick_local_generations_pending
  ON zook_lighttick_local_generations (app_id,user_id)
  WHERE status='prepared';
