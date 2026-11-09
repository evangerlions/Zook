-- Durable deletion outbox; no FK to a membership/app that may already have been removed.
CREATE TABLE IF NOT EXISTS zook_owner_file_purges (
 id TEXT PRIMARY KEY,app_id TEXT NOT NULL,user_id TEXT NOT NULL,storage_key TEXT NOT NULL,
 attempt INTEGER NOT NULL DEFAULT 0,lease_token TEXT,lease_until TIMESTAMPTZ,next_attempt_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
 UNIQUE(app_id,user_id,storage_key)
);
CREATE INDEX IF NOT EXISTS zook_owner_file_purges_due ON zook_owner_file_purges(next_attempt_at,lease_until);
