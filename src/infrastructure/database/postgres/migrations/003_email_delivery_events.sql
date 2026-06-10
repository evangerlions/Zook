CREATE TABLE IF NOT EXISTS zook_email_delivery_events (
  id TEXT PRIMARY KEY,
  provider TEXT NOT NULL,
  event TEXT NOT NULL,
  event_id INTEGER,
  email TEXT NOT NULL,
  link TEXT,
  bulk_id TEXT,
  event_timestamp BIGINT,
  reason TEXT,
  bounce_type TEXT,
  username TEXT,
  sender_address TEXT,
  from_domain TEXT,
  template_id INTEGER,
  subject TEXT,
  message_id TEXT,
  user_agent TEXT,
  sent_timestamp BIGINT,
  raw_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  occurred_at TIMESTAMPTZ NOT NULL,
  received_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS zook_email_delivery_events_received_idx
  ON zook_email_delivery_events (received_at DESC);

CREATE INDEX IF NOT EXISTS zook_email_delivery_events_event_received_idx
  ON zook_email_delivery_events (event, received_at DESC);

CREATE INDEX IF NOT EXISTS zook_email_delivery_events_email_received_idx
  ON zook_email_delivery_events (lower(email), received_at DESC);

CREATE INDEX IF NOT EXISTS zook_email_delivery_events_message_idx
  ON zook_email_delivery_events (message_id)
  WHERE message_id IS NOT NULL;
