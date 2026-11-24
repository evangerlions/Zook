CREATE TABLE IF NOT EXISTS zook_lighttick_planned_rest_dates (
  app_id text NOT NULL,
  user_id text NOT NULL,
  date date NOT NULL,
  planned_rest boolean NOT NULL,
  version integer NOT NULL CHECK (version > 0),
  PRIMARY KEY (app_id, user_id, date)
);
