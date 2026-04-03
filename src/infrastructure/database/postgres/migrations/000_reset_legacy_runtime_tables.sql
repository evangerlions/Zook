-- The project is still pre-launch, so legacy snapshot-style PostgreSQL tables
-- can be discarded instead of migrated forward.
-- This reset must run at most once per database. CI/CD replays every SQL file
-- on every deploy, so we guard on zook_schema_migrations before dropping.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM zook_schema_migrations
    WHERE name = '000_reset_legacy_runtime_tables.sql'
  ) THEN
    RETURN;
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = current_schema()
      AND table_name = 'zook_apps'
      AND column_name = 'payload'
  ) THEN
    DROP TABLE IF EXISTS zook_client_log_lines;
    DROP TABLE IF EXISTS zook_client_log_uploads;
    DROP TABLE IF EXISTS zook_client_log_upload_tasks;
    DROP TABLE IF EXISTS zook_files;
    DROP TABLE IF EXISTS zook_analytics_events;
    DROP TABLE IF EXISTS zook_app_configs;
    DROP TABLE IF EXISTS zook_failed_events;
    DROP TABLE IF EXISTS zook_notification_jobs;
    DROP TABLE IF EXISTS zook_audit_logs;
    DROP TABLE IF EXISTS zook_refresh_tokens;
    DROP TABLE IF EXISTS zook_user_roles;
    DROP TABLE IF EXISTS zook_role_permissions;
    DROP TABLE IF EXISTS zook_permissions;
    DROP TABLE IF EXISTS zook_roles;
    DROP TABLE IF EXISTS zook_app_users;
    DROP TABLE IF EXISTS zook_users;
    DROP TABLE IF EXISTS zook_apps;
  END IF;
END $$;
