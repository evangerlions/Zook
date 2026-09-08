-- Claim and settlement data commit together. Failed/crashed transactions
-- roll back both, permitting safe retries by another worker.
CREATE TABLE IF NOT EXISTS bodylog_settlement_jobs (
  key TEXT PRIMARY KEY,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
