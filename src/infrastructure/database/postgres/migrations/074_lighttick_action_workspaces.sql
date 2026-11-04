-- Additive Grow-linked actions; rollback retains data and keeps the source frozen.
CREATE TABLE IF NOT EXISTS zook_lighttick_action_workspaces (
 app_id TEXT NOT NULL CHECK(app_id='lighttick'), user_id TEXT NOT NULL,
 payload JSONB NOT NULL, version INTEGER NOT NULL CHECK(version>0),
 PRIMARY KEY(app_id,user_id)
);
CREATE TABLE IF NOT EXISTS zook_lighttick_action_tickets (
 hash TEXT PRIMARY KEY,app_id TEXT NOT NULL CHECK(app_id='lighttick'),user_id TEXT NOT NULL,
 payload JSONB NOT NULL,expires_at TIMESTAMPTZ NOT NULL
);
CREATE INDEX IF NOT EXISTS zook_lighttick_action_tickets_owner_idx ON zook_lighttick_action_tickets(app_id,user_id);
CREATE TABLE IF NOT EXISTS zook_lighttick_action_links (
 source_account_id TEXT PRIMARY KEY,app_id TEXT NOT NULL CHECK(app_id='lighttick'),user_id TEXT NOT NULL,
 payload JSONB NOT NULL,UNIQUE(app_id,user_id)
);
