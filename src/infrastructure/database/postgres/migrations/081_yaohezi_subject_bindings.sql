-- Routing metadata only. No names, medical content, keys or implicit grants.
CREATE TABLE IF NOT EXISTS zook_yaohezi_subjects (
  app_id TEXT NOT NULL CHECK (app_id = 'yaohezi'),
  subject_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (app_id, subject_id),
  FOREIGN KEY (app_id) REFERENCES zook_apps(id) ON DELETE RESTRICT
);
CREATE TABLE IF NOT EXISTS zook_yaohezi_subject_accounts (
  app_id TEXT NOT NULL CHECK (app_id = 'yaohezi'),
  subject_id UUID NOT NULL,
  user_id TEXT NOT NULL,
  binding_kind TEXT NOT NULL CHECK (binding_kind = 'self_asserted'),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (app_id, subject_id, user_id),
  UNIQUE (app_id, user_id),
  UNIQUE (app_id, subject_id),
  FOREIGN KEY (app_id, subject_id) REFERENCES zook_yaohezi_subjects(app_id, subject_id) ON DELETE RESTRICT,
  FOREIGN KEY (app_id, user_id) REFERENCES zook_app_users(app_id, user_id) ON DELETE RESTRICT
);
CREATE TABLE IF NOT EXISTS zook_yaohezi_binding_receipts (
  app_id TEXT NOT NULL CHECK (app_id = 'yaohezi'),
  user_id TEXT NOT NULL,
  operation_id UUID NOT NULL,
  subject_id UUID NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (app_id, user_id, operation_id),
  FOREIGN KEY (app_id, subject_id, user_id)
    REFERENCES zook_yaohezi_subject_accounts(app_id, subject_id, user_id) ON DELETE RESTRICT
);
