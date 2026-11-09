-- Isolated legacy form scope; independent records, actions and learning facts stay in their own domains.
CREATE TABLE IF NOT EXISTS zook_lighttick_form_records (
  app_id TEXT NOT NULL CHECK(app_id='lighttick'),
  user_id TEXT NOT NULL,
  revision INTEGER NOT NULL CHECK(revision>0),
  payload JSONB NOT NULL CHECK(jsonb_typeof(payload)='object'),
  PRIMARY KEY(app_id,user_id)
);
