CREATE TABLE IF NOT EXISTS zook_lighttick_investment_bucket_versions (
  app_id TEXT NOT NULL CHECK (app_id = 'lighttick'),
  user_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  payload JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  PRIMARY KEY (app_id, user_id, account_id, revision)
);
