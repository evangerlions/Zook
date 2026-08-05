ALTER TABLE zook_frogsleep_buddy_invitation_bundles
  ADD COLUMN IF NOT EXISTS recipient_email TEXT,
  ADD COLUMN IF NOT EXISTS recipient_email_hash TEXT,
  ADD COLUMN IF NOT EXISTS share_code TEXT,
  ADD COLUMN IF NOT EXISTS handoff_token TEXT,
  ADD COLUMN IF NOT EXISTS share_link TEXT,
  ADD COLUMN IF NOT EXISTS locale TEXT NOT NULL DEFAULT 'zh-CN';

UPDATE zook_frogsleep_buddy_invitation_bundles
SET share_code = COALESCE(share_code, UPPER(SUBSTRING(MD5(app_id || ':' || id), 1, 8))),
    handoff_token = COALESCE(handoff_token, 'legacy_' || MD5(id || ':' || created_at::text)),
    share_link = COALESCE(
      share_link,
      'frogsleep://buddy-invitation?mode=preview&invitation_id=' || id
    )
WHERE share_code IS NULL OR handoff_token IS NULL OR share_link IS NULL;

ALTER TABLE zook_frogsleep_buddy_invitation_bundles
  ALTER COLUMN share_code SET NOT NULL,
  ALTER COLUMN handoff_token SET NOT NULL,
  ALTER COLUMN share_link SET NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS uq_frogsleep_buddy_bundle_code
  ON zook_frogsleep_buddy_invitation_bundles (app_id, UPPER(share_code));
CREATE UNIQUE INDEX IF NOT EXISTS uq_frogsleep_buddy_bundle_token
  ON zook_frogsleep_buddy_invitation_bundles (app_id, handoff_token);
CREATE INDEX IF NOT EXISTS idx_frogsleep_buddy_bundle_recipient_email
  ON zook_frogsleep_buddy_invitation_bundles (app_id, recipient_email_hash, status, created_at DESC);

CREATE TABLE IF NOT EXISTS zook_frogsleep_buddy_invitation_email_deliveries (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL REFERENCES zook_apps(id) ON DELETE CASCADE,
  invitation_id TEXT NOT NULL REFERENCES zook_frogsleep_buddy_invitation_bundles(id) ON DELETE CASCADE,
  recipient_email TEXT NOT NULL,
  recipient_email_hash TEXT NOT NULL,
  locale TEXT NOT NULL DEFAULT 'zh-CN',
  status TEXT NOT NULL DEFAULT 'queued'
    CHECK (status IN ('queued', 'processing', 'provider_accepted', 'delivered', 'bounced',
      'suppressed', 'retryable_failed', 'dead_letter')),
  attempt_count INTEGER NOT NULL DEFAULT 0 CHECK (attempt_count >= 0),
  available_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  provider_request_id TEXT,
  provider_message_id TEXT,
  last_error_code TEXT,
  provider_accepted_at TIMESTAMPTZ,
  delivered_at TIMESTAMPTZ,
  bounced_at TIMESTAMPTZ,
  suppressed_at TIMESTAMPTZ,
  dead_lettered_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (app_id, invitation_id)
);

CREATE TABLE IF NOT EXISTS zook_frogsleep_buddy_invitation_email_attempts (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL REFERENCES zook_apps(id) ON DELETE CASCADE,
  delivery_id TEXT NOT NULL REFERENCES zook_frogsleep_buddy_invitation_email_deliveries(id) ON DELETE CASCADE,
  invitation_id TEXT NOT NULL REFERENCES zook_frogsleep_buddy_invitation_bundles(id) ON DELETE CASCADE,
  attempt INTEGER NOT NULL CHECK (attempt > 0),
  status TEXT NOT NULL CHECK (status IN ('processing', 'provider_accepted', 'retryable_failed', 'permanent_failed')),
  provider_request_id TEXT,
  provider_message_id TEXT,
  error_code TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ,
  UNIQUE (delivery_id, attempt)
);

CREATE INDEX IF NOT EXISTS idx_frogsleep_buddy_email_delivery_ready
  ON zook_frogsleep_buddy_invitation_email_deliveries (status, available_at, created_at)
  WHERE status IN ('queued', 'retryable_failed');
CREATE INDEX IF NOT EXISTS idx_frogsleep_buddy_email_delivery_provider
  ON zook_frogsleep_buddy_invitation_email_deliveries (provider_message_id)
  WHERE provider_message_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_frogsleep_buddy_email_attempt_delivery
  ON zook_frogsleep_buddy_invitation_email_attempts (app_id, delivery_id, attempt);

-- Non-destructively project still-live legacy invitations into the canonical aggregate.
-- The legacy row remains the domain command source and is linked back to this aggregate.
WITH legacy_invites AS (
  SELECT id, app_id, owner_user_id, partner_user_id, status, code, token, payload,
         created_at, updated_at, 'sleep'::TEXT AS domain
  FROM zook_frogsleep_sleep_invites
  WHERE deleted_at IS NULL
    AND status IN ('pending', 'accepted', 'declined', 'cancelled', 'expired')
    AND COALESCE(payload->>'bundle_id', '') = ''
  UNION ALL
  SELECT id, app_id, owner_user_id, partner_user_id, status, code, token, payload,
         created_at, updated_at, 'focus'::TEXT AS domain
  FROM zook_frogsleep_focus_invites
  WHERE deleted_at IS NULL
    AND status IN ('pending', 'accepted', 'declined', 'cancelled', 'expired')
    AND COALESCE(payload->>'bundle_id', '') = ''
)
INSERT INTO zook_frogsleep_buddy_invitation_bundles
  (id, app_id, inviter_user_id, invitee_user_id, recipient_email, recipient_email_hash,
   share_code, handoff_token, share_link, locale, status, domains, version,
   domain_invitation_ids, domain_error_codes, expires_at, responded_at, created_at, updated_at)
SELECT
  'legacy_' || domain || '_' || id,
  app_id,
  owner_user_id,
  partner_user_id,
  NULLIF(COALESCE(payload->>'inviteeEmailSnapshot', payload->>'invitee_email_snapshot'), ''),
  CASE
    WHEN NULLIF(COALESCE(payload->>'inviteeEmailSnapshot', payload->>'invitee_email_snapshot'), '') IS NULL
      THEN NULL
    ELSE MD5(LOWER(TRIM(COALESCE(
      payload->>'inviteeEmailSnapshot',
      payload->>'invitee_email_snapshot'
    ))))
  END,
  COALESCE(NULLIF(UPPER(code), ''), UPPER(SUBSTRING(MD5(app_id || ':' || domain || ':' || id), 1, 8))),
  COALESCE(NULLIF(token, ''), 'legacy_' || MD5(app_id || ':' || domain || ':' || id)),
  'https://app.youwoai.net/frogsleep/buddy-invitation?token=' ||
    COALESCE(NULLIF(token, ''), 'legacy_' || MD5(app_id || ':' || domain || ':' || id)),
  'zh-CN',
  status,
  ARRAY[domain],
  COALESCE(NULLIF(payload->>'version', '')::INTEGER, 1),
  JSONB_BUILD_OBJECT(domain, id),
  '{}'::JSONB,
  COALESCE(NULLIF(COALESCE(payload->>'expires_at', payload->>'expiresAt'), '')::TIMESTAMPTZ,
    created_at + INTERVAL '7 days'),
  CASE WHEN status = 'pending' THEN NULL ELSE updated_at END,
  created_at,
  updated_at
FROM legacy_invites
WHERE owner_user_id IS NOT NULL
ON CONFLICT DO NOTHING;

UPDATE zook_frogsleep_sleep_invites legacy
SET payload = legacy.payload || JSONB_BUILD_OBJECT('bundle_id', bundle.id)
FROM zook_frogsleep_buddy_invitation_bundles bundle
WHERE bundle.id = 'legacy_sleep_' || legacy.id
  AND COALESCE(legacy.payload->>'bundle_id', '') = '';

UPDATE zook_frogsleep_focus_invites legacy
SET payload = legacy.payload || JSONB_BUILD_OBJECT('bundle_id', bundle.id)
FROM zook_frogsleep_buddy_invitation_bundles bundle
WHERE bundle.id = 'legacy_focus_' || legacy.id
  AND COALESCE(legacy.payload->>'bundle_id', '') = '';

INSERT INTO zook_frogsleep_buddy_invitation_domain_decisions
  (app_id, invitation_id, domain, status, version, created_at, updated_at)
SELECT app_id, id, domains[1], status, version, created_at, updated_at
FROM zook_frogsleep_buddy_invitation_bundles
WHERE id LIKE 'legacy_sleep_%' OR id LIKE 'legacy_focus_%'
ON CONFLICT (app_id, invitation_id, domain) DO NOTHING;
