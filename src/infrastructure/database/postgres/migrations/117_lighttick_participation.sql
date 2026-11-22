CREATE TABLE IF NOT EXISTS zook_lighttick_registration_invitations (
 app_id TEXT NOT NULL,user_id TEXT NOT NULL,id TEXT NOT NULL,created_at TIMESTAMPTZ NOT NULL,
 expires_at TIMESTAMPTZ NOT NULL,revoked BOOLEAN NOT NULL DEFAULT FALSE,used_at TIMESTAMPTZ,token_hash TEXT NOT NULL,
 PRIMARY KEY(app_id,user_id,id),UNIQUE(app_id,id)
);
CREATE INDEX IF NOT EXISTS lighttick_registration_invites_owner ON zook_lighttick_registration_invitations(app_id,user_id,created_at DESC);
CREATE TABLE IF NOT EXISTS zook_lighttick_invitation_claims (
 app_id TEXT NOT NULL,user_id TEXT NOT NULL,invitation_id TEXT NOT NULL,
 PRIMARY KEY(app_id,user_id),UNIQUE(app_id,invitation_id)
);
CREATE TABLE IF NOT EXISTS zook_lighttick_trial_participation (
 app_id TEXT NOT NULL,user_id TEXT NOT NULL,payload JSONB NOT NULL,
 PRIMARY KEY(app_id,user_id)
);
