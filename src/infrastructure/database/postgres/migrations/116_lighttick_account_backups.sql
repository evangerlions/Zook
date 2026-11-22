CREATE TABLE IF NOT EXISTS zook_lighttick_account_backups (
 app_id TEXT NOT NULL,user_id TEXT NOT NULL,id TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('export','preview','rollback')),
 created_at TIMESTAMPTZ NOT NULL,data JSONB NOT NULL,summary JSONB NOT NULL,
 PRIMARY KEY(app_id,user_id,id)
);
CREATE INDEX IF NOT EXISTS lighttick_backups_owner_created ON zook_lighttick_account_backups(app_id,user_id,created_at DESC);
