-- Reporting evidence is committed with the canonical balance/receipt transaction.
-- No backfill: historical timestamps/pool splits cannot safely be reconstructed.
CREATE TABLE IF NOT EXISTS zook_ai_novel_credit_events (
  user_id text NOT NULL,
  event_id text NOT NULL,
  occurred_at timestamptz NOT NULL,
  payload jsonb NOT NULL,
  PRIMARY KEY(user_id, event_id)
);
CREATE INDEX IF NOT EXISTS zook_credit_events_time ON zook_ai_novel_credit_events(occurred_at, user_id);
CREATE TABLE IF NOT EXISTS zook_ai_novel_credit_windows (
  user_id text NOT NULL,
  period_key timestamptz NOT NULL,
  refresh_at timestamptz NOT NULL,
  payload jsonb NOT NULL,
  PRIMARY KEY(user_id, period_key)
);
CREATE INDEX IF NOT EXISTS zook_credit_windows_time ON zook_ai_novel_credit_windows(period_key, refresh_at);
CREATE TABLE IF NOT EXISTS zook_ai_novel_credit_reporting_metadata (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  started_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO zook_ai_novel_credit_reporting_metadata(singleton) VALUES(true) ON CONFLICT DO NOTHING;
