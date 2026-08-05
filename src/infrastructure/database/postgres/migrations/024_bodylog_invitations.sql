CREATE TABLE IF NOT EXISTS zook_bodylog_invitations (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL,
  inviter_user_id TEXT NOT NULL,
  inviter_install_id_hash TEXT NOT NULL,
  token_hash TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL
);

CREATE TABLE IF NOT EXISTS zook_bodylog_invitation_attributions (
  id TEXT PRIMARY KEY,
  app_id TEXT NOT NULL,
  invitation_id TEXT NOT NULL,
  inviter_user_id TEXT NOT NULL,
  invitee_user_id TEXT NOT NULL,
  install_id_hash TEXT NOT NULL,
  completed_dates JSONB NOT NULL DEFAULT '[]'::jsonb,
  attributed_at TIMESTAMPTZ NOT NULL,
  qualified_at TIMESTAMPTZ,
  rewarded_at TIMESTAMPTZ,
  inviter_reward_ends_at TIMESTAMPTZ,
  invitee_reward_ends_at TIMESTAMPTZ,
  UNIQUE (app_id, invitee_user_id),
  UNIQUE (app_id, install_id_hash)
);

CREATE INDEX IF NOT EXISTS idx_bodylog_invitation_inviter
  ON zook_bodylog_invitation_attributions (app_id, inviter_user_id, attributed_at DESC);
