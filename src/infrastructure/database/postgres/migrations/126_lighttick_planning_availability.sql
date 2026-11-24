CREATE TABLE IF NOT EXISTS zook_lighttick_planning_availability (
  app_id text NOT NULL,
  user_id text NOT NULL,
  available_weekdays smallint[] CHECK (
    cardinality(available_weekdays) <= 7 AND
    array_position(available_weekdays, NULL) IS NULL AND
    available_weekdays <@ ARRAY[1, 2, 3, 4, 5, 6, 7]::smallint[]
  ),
  version integer NOT NULL CHECK (version > 0),
  PRIMARY KEY (app_id, user_id)
);
