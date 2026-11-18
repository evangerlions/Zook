CREATE TABLE IF NOT EXISTS zook_lighttick_investment_journal (
  app_id TEXT NOT NULL CHECK (app_id = 'lighttick'),
  user_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK (revision > 0),
  payload JSONB NOT NULL CHECK (jsonb_typeof(payload) = 'object'),
  PRIMARY KEY (app_id, user_id)
);

CREATE INDEX IF NOT EXISTS zook_lighttick_investment_events_instrument
  ON zook_lighttick_investment_events (app_id, user_id, instrument_id, account_id)
  WHERE instrument_id IS NOT NULL;
