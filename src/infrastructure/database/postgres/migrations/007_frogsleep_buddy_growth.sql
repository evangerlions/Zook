CREATE TABLE IF NOT EXISTS zook_frogsleep_buddy_sharing_grants (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL REFERENCES zook_apps(id) ON DELETE CASCADE,
  relationship_id TEXT NOT NULL,
  grantor_user_id TEXT NOT NULL REFERENCES zook_users(id) ON DELETE CASCADE,
  grantee_user_id TEXT NOT NULL REFERENCES zook_users(id) ON DELETE CASCADE,
  domain TEXT NOT NULL CHECK (domain IN ('sleep', 'focus')),
  category TEXT NOT NULL CHECK (category IN ('presence', 'daily_summary', 'weekly_trend', 'shared_activity')),
  state TEXT NOT NULL CHECK (state IN ('granted', 'revoked')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  granted_at TIMESTAMPTZ,
  revoked_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (app_id, relationship_id, grantor_user_id, grantee_user_id, domain, category),
  CHECK (grantor_user_id <> grantee_user_id)
);

CREATE TABLE IF NOT EXISTS zook_frogsleep_buddy_invitation_bundles (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL REFERENCES zook_apps(id) ON DELETE CASCADE,
  inviter_user_id TEXT NOT NULL REFERENCES zook_users(id) ON DELETE CASCADE,
  invitee_user_id TEXT REFERENCES zook_users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled', 'expired')),
  domains TEXT[] NOT NULL,
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  expires_at TIMESTAMPTZ NOT NULL,
  responded_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  CHECK (array_length(domains, 1) BETWEEN 1 AND 2),
  CHECK (domains <@ ARRAY['sleep', 'focus']::TEXT[])
);

CREATE TABLE IF NOT EXISTS zook_frogsleep_buddy_invitation_receipts (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL REFERENCES zook_apps(id) ON DELETE CASCADE,
  invitation_kind TEXT NOT NULL CHECK (invitation_kind IN ('sleep_invite', 'focus_invite', 'bundle')),
  invitation_id TEXT NOT NULL,
  bundle_id TEXT REFERENCES zook_frogsleep_buddy_invitation_bundles(id) ON DELETE CASCADE,
  inviter_user_id TEXT NOT NULL REFERENCES zook_users(id) ON DELETE CASCADE,
  invitee_user_id TEXT REFERENCES zook_users(id) ON DELETE CASCADE,
  status TEXT NOT NULL CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled', 'expired')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  recipient_read_at TIMESTAMPTZ,
  sender_read_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (app_id, invitation_kind, invitation_id)
);

CREATE TABLE IF NOT EXISTS zook_frogsleep_buddy_notification_outbox (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL REFERENCES zook_apps(id) ON DELETE CASCADE,
  recipient_user_id TEXT NOT NULL REFERENCES zook_users(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  deduplication_key TEXT NOT NULL,
  safe_route JSONB NOT NULL DEFAULT '{}'::jsonb,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'delivered', 'failed', 'dead_letter')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  processed_at TIMESTAMPTZ,
  last_error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (app_id, deduplication_key)
);

CREATE TABLE IF NOT EXISTS zook_frogsleep_buddy_notifications (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL REFERENCES zook_apps(id) ON DELETE CASCADE,
  recipient_user_id TEXT NOT NULL REFERENCES zook_users(id) ON DELETE CASCADE,
  outbox_id TEXT NOT NULL REFERENCES zook_frogsleep_buddy_notification_outbox(id) ON DELETE CASCADE,
  notification_type TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT NOT NULL,
  safe_route JSONB NOT NULL DEFAULT '{}'::jsonb,
  read_at TIMESTAMPTZ,
  expires_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (app_id, recipient_user_id, outbox_id)
);

CREATE TABLE IF NOT EXISTS zook_frogsleep_buddy_notification_deliveries (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL REFERENCES zook_apps(id) ON DELETE CASCADE,
  notification_id TEXT NOT NULL REFERENCES zook_frogsleep_buddy_notifications(id) ON DELETE CASCADE,
  channel TEXT NOT NULL CHECK (channel IN ('in_app', 'apns')),
  status TEXT NOT NULL CHECK (status IN ('pending', 'delivered', 'failed', 'suppressed')),
  attempt INTEGER NOT NULL DEFAULT 1 CHECK (attempt > 0),
  provider_message_id TEXT,
  error_code TEXT,
  delivered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (notification_id, channel, attempt)
);

CREATE INDEX IF NOT EXISTS idx_frogsleep_buddy_grants_viewer
  ON zook_frogsleep_buddy_sharing_grants (app_id, grantee_user_id, relationship_id, domain, category, state);
CREATE INDEX IF NOT EXISTS idx_frogsleep_buddy_invitation_receipts_inbox
  ON zook_frogsleep_buddy_invitation_receipts (app_id, invitee_user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_frogsleep_buddy_invitation_receipts_outbox
  ON zook_frogsleep_buddy_invitation_receipts (app_id, inviter_user_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_frogsleep_buddy_outbox_ready
  ON zook_frogsleep_buddy_notification_outbox (status, available_at, created_at) WHERE status IN ('pending', 'failed');
CREATE INDEX IF NOT EXISTS idx_frogsleep_buddy_notifications_unread
  ON zook_frogsleep_buddy_notifications (app_id, recipient_user_id, created_at DESC) WHERE read_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_frogsleep_buddy_notification_deliveries_status
  ON zook_frogsleep_buddy_notification_deliveries (status, created_at);

CREATE OR REPLACE FUNCTION frogsleep_transition_buddy_invitation(
  receipt_id TEXT,
  expected_version INTEGER,
  terminal_status TEXT,
  outbox_id TEXT,
  event_type TEXT,
  deduplication_key TEXT,
  safe_route JSONB
) RETURNS zook_frogsleep_buddy_invitation_receipts
LANGUAGE plpgsql
AS $$
DECLARE
  current_receipt zook_frogsleep_buddy_invitation_receipts;
  current_version INTEGER;
BEGIN
  SELECT * INTO current_receipt FROM zook_frogsleep_buddy_invitation_receipts
  WHERE id = receipt_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'buddy invitation not found' USING ERRCODE = 'P0002'; END IF;
  current_version := current_receipt.version;
  IF current_receipt.status <> 'pending' THEN RAISE EXCEPTION 'buddy invitation is terminal' USING ERRCODE = 'P0001'; END IF;
  IF current_version <> expected_version THEN RAISE EXCEPTION 'buddy invitation version conflict' USING ERRCODE = '40001'; END IF;
  IF terminal_status NOT IN ('accepted', 'declined', 'cancelled', 'expired') THEN
    RAISE EXCEPTION 'invalid buddy invitation terminal status' USING ERRCODE = '22023';
  END IF;

  UPDATE zook_frogsleep_buddy_invitation_receipts
  SET status = terminal_status, version = version + 1, updated_at = NOW()
  WHERE id = receipt_id RETURNING * INTO current_receipt;

  INSERT INTO zook_frogsleep_buddy_notification_outbox
    (id, app_id, recipient_user_id, event_type, target_type, target_id, deduplication_key, safe_route)
  VALUES
    (outbox_id, current_receipt.app_id, current_receipt.inviter_user_id, event_type,
     'buddy_invitation', current_receipt.invitation_id, deduplication_key, safe_route)
  ON CONFLICT (app_id, deduplication_key) DO NOTHING;
  RETURN current_receipt;
END;
$$;
