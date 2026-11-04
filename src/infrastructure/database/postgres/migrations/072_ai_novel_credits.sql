CREATE TABLE IF NOT EXISTS zook_ai_novel_credit_accounts (
  user_id TEXT PRIMARY KEY,
  payload JSONB,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS zook_ai_novel_credit_jobs (
  user_id TEXT NOT NULL REFERENCES zook_ai_novel_credit_accounts(user_id) ON DELETE CASCADE,
  job_id TEXT NOT NULL,
  payload JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY(user_id, job_id)
);
