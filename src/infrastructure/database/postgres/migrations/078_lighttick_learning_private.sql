CREATE TABLE IF NOT EXISTS zook_lighttick_learning_private (
 app_id TEXT NOT NULL, user_id TEXT NOT NULL, payload JSONB NOT NULL,
 PRIMARY KEY(app_id,user_id)
);
