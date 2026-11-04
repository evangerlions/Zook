WITH ranked AS (
  SELECT id, RANK() OVER (PARTITION BY app_id,platform,push_token ORDER BY updated_at DESC) AS latest_rank,
    COUNT(*) OVER (PARTITION BY app_id,platform,push_token,updated_at) AS same_time_count,
    ROW_NUMBER() OVER (
    PARTITION BY app_id,platform,push_token ORDER BY updated_at DESC,created_at DESC,id DESC
  ) AS position FROM zook_frogsleep_devices WHERE deleted_at IS NULL AND app_id='frogsleep'
)
UPDATE zook_frogsleep_devices AS device SET deleted_at=NOW(),push_enabled=FALSE,updated_at=NOW()
FROM ranked WHERE device.id=ranked.id
  AND (ranked.position>1 OR (ranked.latest_rank=1 AND ranked.same_time_count>1));
CREATE UNIQUE INDEX IF NOT EXISTS uq_frogsleep_devices_legacy_scope
  ON zook_frogsleep_devices(app_id,user_id,push_token) WHERE app_id<>'frogsleep';
ALTER TABLE zook_frogsleep_devices
  DROP CONSTRAINT IF EXISTS zook_frogsleep_devices_app_id_user_id_push_token_key;
CREATE UNIQUE INDEX IF NOT EXISTS uq_frogsleep_devices_live_token
  ON zook_frogsleep_devices(app_id,platform,push_token) WHERE deleted_at IS NULL AND app_id='frogsleep';
