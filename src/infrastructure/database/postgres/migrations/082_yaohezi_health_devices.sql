-- Health trust is separate from login/self-asserted routing. No plaintext DEKs, device private keys or health content.
CREATE TABLE IF NOT EXISTS zook_yaohezi_health_authorities (
  subject_id UUID PRIMARY KEY,
  app_id TEXT NOT NULL DEFAULT 'yaohezi' CHECK (app_id='yaohezi'),
  owner_user_id TEXT NOT NULL UNIQUE,
  key_epoch INTEGER NOT NULL CHECK (key_epoch > 0),
  recovery_version INTEGER NOT NULL CHECK (recovery_version > 0),
  recovery_public_key TEXT NOT NULL,
  recovery_vault JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  FOREIGN KEY (app_id,subject_id,owner_user_id) REFERENCES zook_yaohezi_subject_accounts(app_id,subject_id,user_id) ON DELETE RESTRICT
);
CREATE TABLE IF NOT EXISTS zook_yaohezi_health_devices (
  device_id UUID PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES zook_users(id) ON DELETE RESTRICT,
  signing_key TEXT NOT NULL UNIQUE,
  wrapping_key TEXT NOT NULL UNIQUE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS zook_yaohezi_health_grants (
  subject_id UUID NOT NULL REFERENCES zook_yaohezi_health_authorities(subject_id) ON DELETE RESTRICT,
  device_id UUID NOT NULL REFERENCES zook_yaohezi_health_devices(device_id) ON DELETE RESTRICT,
  role TEXT NOT NULL CHECK (role IN ('owner','reader')),
  resources JSONB NOT NULL,
  grant_version INTEGER NOT NULL CHECK (grant_version > 0),
  revoked BOOLEAN NOT NULL DEFAULT false,
  authorization_proof JSONB NOT NULL,
  PRIMARY KEY(subject_id,device_id)
);
CREATE TABLE IF NOT EXISTS zook_yaohezi_health_challenges (
  id UUID PRIMARY KEY, subject_id UUID NOT NULL, user_id TEXT NOT NULL REFERENCES zook_users(id) ON DELETE RESTRICT,
  purpose TEXT NOT NULL CHECK (purpose IN ('bootstrap','enroll','sessions','recover')),
  descriptor JSONB NOT NULL, nonce TEXT NOT NULL UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL, used BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS zook_yaohezi_health_challenges_account ON zook_yaohezi_health_challenges(user_id,created_at);
CREATE TABLE IF NOT EXISTS zook_yaohezi_health_sessions (
  token_hash TEXT PRIMARY KEY, subject_id UUID NOT NULL, device_id UUID NOT NULL, user_id TEXT NOT NULL,
  grant_version INTEGER NOT NULL, key_epoch INTEGER NOT NULL, expires_at TIMESTAMPTZ NOT NULL,
  revoked BOOLEAN NOT NULL DEFAULT false,
  FOREIGN KEY(subject_id,device_id) REFERENCES zook_yaohezi_health_grants(subject_id,device_id) ON DELETE RESTRICT
);
CREATE TABLE IF NOT EXISTS zook_yaohezi_health_capsules (
  subject_id UUID NOT NULL, device_id UUID NOT NULL, resource_id UUID NOT NULL, resource_version UUID NOT NULL,
  key_epoch INTEGER NOT NULL, grant_version INTEGER NOT NULL, capsule JSONB NOT NULL,
  PRIMARY KEY(subject_id,device_id,resource_id,resource_version),
  FOREIGN KEY(subject_id,device_id) REFERENCES zook_yaohezi_health_grants(subject_id,device_id) ON DELETE RESTRICT
);
CREATE TABLE IF NOT EXISTS zook_yaohezi_health_receipts (
  subject_id UUID NOT NULL REFERENCES zook_yaohezi_health_authorities(subject_id) ON DELETE RESTRICT,
  operation_id UUID NOT NULL, device_id UUID NOT NULL, command_hash TEXT NOT NULL,
  action TEXT NOT NULL, result JSONB NOT NULL, PRIMARY KEY(subject_id,operation_id)
);
CREATE TABLE IF NOT EXISTS zook_yaohezi_health_audit (
  id BIGSERIAL PRIMARY KEY, subject_id UUID NOT NULL, user_id TEXT NOT NULL, device_id UUID NOT NULL,
  action TEXT NOT NULL, operation_id UUID NOT NULL, key_epoch INTEGER NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
