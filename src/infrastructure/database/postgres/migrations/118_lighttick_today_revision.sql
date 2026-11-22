CREATE TABLE IF NOT EXISTS zook_lighttick_today_revisions (
  app_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  revision BIGINT NOT NULL CHECK (revision >= 0),
  PRIMARY KEY (app_id, user_id)
);

CREATE OR REPLACE FUNCTION zook_lighttick_bump_today_revision() RETURNS TRIGGER
LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND OLD IS NOT DISTINCT FROM NEW THEN
    RETURN NULL;
  END IF;

  IF TG_OP = 'DELETE' OR
    (TG_OP = 'UPDATE' AND (OLD.app_id, OLD.user_id) IS DISTINCT FROM (NEW.app_id, NEW.user_id)) THEN
    INSERT INTO zook_lighttick_today_revisions VALUES (OLD.app_id, OLD.user_id, 1)
    ON CONFLICT (app_id, user_id) DO UPDATE SET revision = zook_lighttick_today_revisions.revision + 1;
  END IF;

  IF TG_OP <> 'DELETE' THEN
    INSERT INTO zook_lighttick_today_revisions VALUES (NEW.app_id, NEW.user_id, 1)
    ON CONFLICT (app_id, user_id) DO UPDATE SET revision = zook_lighttick_today_revisions.revision + 1;
  END IF;
  RETURN NULL;
END;
$$;

DO $$
DECLARE owner_table TEXT;
BEGIN
  FOREACH owner_table IN ARRAY ARRAY[
    'goals', 'plan_cycles', 'tasks', 'task_steps', 'learning_routes',
    'learning_route_versions', 'learning_route_lessons', 'learning_authorities',
    'learning_collections', 'native_lessons', 'lesson_publications'
  ]
  LOOP
    EXECUTE format('CREATE OR REPLACE TRIGGER lighttick_today_revision AFTER INSERT OR UPDATE OR DELETE ON %I
      FOR EACH ROW EXECUTE FUNCTION zook_lighttick_bump_today_revision()', 'zook_lighttick_' || owner_table);
  END LOOP;
END;
$$;

CREATE OR REPLACE TRIGGER lighttick_today_revision
AFTER INSERT OR UPDATE OF timezone, app_id, user_id OR DELETE ON zook_lighttick_profiles
FOR EACH ROW EXECUTE FUNCTION zook_lighttick_bump_today_revision();

CREATE OR REPLACE TRIGGER lighttick_today_revision
AFTER INSERT OR UPDATE OF completed, content_version, app_id, user_id OR DELETE ON zook_lighttick_native_learning_private
FOR EACH ROW EXECUTE FUNCTION zook_lighttick_bump_today_revision();

-- Install the triggers before reading the baseline. Their table locks cover old writers until commit.
-- Preserve the largest persisted version an older Today client could have seen.
INSERT INTO zook_lighttick_today_revisions (app_id, user_id, revision)
SELECT app_id, user_id, MAX(version)
FROM (
  SELECT app_id, user_id, version FROM zook_lighttick_goals
  UNION ALL SELECT app_id, user_id, version FROM zook_lighttick_plan_cycles
  UNION ALL SELECT app_id, user_id, version FROM zook_lighttick_tasks
  UNION ALL SELECT app_id, user_id, entity_version FROM zook_lighttick_change_log
    WHERE entity_type IN ('goal', 'plan', 'task')
) AS versions
GROUP BY app_id, user_id
ON CONFLICT (app_id, user_id) DO UPDATE SET revision = EXCLUDED.revision
WHERE zook_lighttick_today_revisions.revision < EXCLUDED.revision;
