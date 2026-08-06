ALTER TABLE zook_app_users
  ADD COLUMN IF NOT EXISTS account_region TEXT NOT NULL DEFAULT 'UNKNOWN';

ALTER TABLE zook_app_users
  ALTER COLUMN account_region SET DEFAULT 'UNKNOWN';

UPDATE zook_app_users
SET account_region = 'UNKNOWN'
WHERE account_region IS NULL
   OR account_region NOT IN ('CN', 'GLOBAL', 'UNKNOWN');

ALTER TABLE zook_app_users
  ALTER COLUMN account_region SET NOT NULL;

ALTER TABLE zook_app_users
  DROP CONSTRAINT IF EXISTS zook_app_users_account_region_check;

ALTER TABLE zook_app_users
  ADD CONSTRAINT zook_app_users_account_region_check
  CHECK (account_region IN ('CN', 'GLOBAL', 'UNKNOWN'));
