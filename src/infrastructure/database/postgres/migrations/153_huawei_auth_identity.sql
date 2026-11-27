-- Keep the existing identity table/write path and expand its provider constraint.
ALTER TABLE zook_app_auth_identities
  DROP CONSTRAINT IF EXISTS zook_app_auth_identities_kind_check;
ALTER TABLE zook_app_auth_identities
  ADD CONSTRAINT zook_app_auth_identities_kind_check
  CHECK (kind IN ('email', 'phone', 'wechat', 'google', 'apple', 'huawei'));
