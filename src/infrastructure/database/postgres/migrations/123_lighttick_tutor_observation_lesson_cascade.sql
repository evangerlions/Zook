ALTER TABLE zook_lighttick_tutor_observations
  ADD CONSTRAINT lighttick_tutor_observations_lesson_owner_fk
  FOREIGN KEY (app_id, user_id, lesson_id)
  REFERENCES zook_lighttick_native_lessons (app_id, user_id, id)
  ON DELETE CASCADE;
