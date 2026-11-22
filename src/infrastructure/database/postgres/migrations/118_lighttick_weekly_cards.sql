CREATE TABLE IF NOT EXISTS zook_lighttick_weekly_cards (
 app_id TEXT NOT NULL,user_id TEXT NOT NULL,week_start DATE NOT NULL,
 revision INTEGER NOT NULL CHECK(revision>0),data JSONB NOT NULL,
 PRIMARY KEY(app_id,user_id,week_start)
);
