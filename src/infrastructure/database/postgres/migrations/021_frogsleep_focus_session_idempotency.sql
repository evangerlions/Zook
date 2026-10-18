LOCK TABLE zook_frogsleep_focus_sessions IN ACCESS EXCLUSIVE MODE;

CREATE TEMP TABLE frogsleep_focus_session_merge ON COMMIT DROP AS
SELECT id,
  first_value(id) OVER (PARTITION BY app_id, owner_user_id, payload->>'client_session_id'
    ORDER BY created_at, id) AS keep_id,
  first_value(id) OVER (PARTITION BY app_id, owner_user_id, payload->>'client_session_id'
    ORDER BY updated_at DESC, created_at DESC, id DESC) AS latest_id
FROM zook_frogsleep_focus_sessions
WHERE deleted_at IS NULL AND owner_user_id IS NOT NULL
  AND jsonb_typeof(payload->'client_session_id') = 'string'
  AND length(payload->>'client_session_id') BETWEEN 1 AND 128
  AND btrim(payload->>'client_session_id') <> '';

UPDATE zook_frogsleep_focus_sessions AS kept
SET status = latest.status, starts_at = latest.starts_at, ends_at = latest.ends_at,
    occurred_at = latest.occurred_at, payload = latest.payload, updated_at = latest.updated_at
FROM frogsleep_focus_session_merge AS mapping, zook_frogsleep_focus_sessions AS latest
WHERE mapping.id = mapping.keep_id AND kept.id = mapping.keep_id AND latest.id = mapping.latest_id
  AND mapping.keep_id <> mapping.latest_id;

UPDATE zook_frogsleep_focus_shared_moments AS moment
SET payload = jsonb_set(moment.payload, '{session_id}', to_jsonb(mapping.keep_id))
FROM frogsleep_focus_session_merge AS mapping
WHERE mapping.id <> mapping.keep_id AND moment.payload->>'session_id' = mapping.id;

UPDATE zook_frogsleep_focus_shared_moments AS moment
SET payload = jsonb_set(moment.payload, '{buddy_session_id}', to_jsonb(mapping.keep_id))
FROM frogsleep_focus_session_merge AS mapping
WHERE mapping.id <> mapping.keep_id AND moment.payload->>'buddy_session_id' = mapping.id;

UPDATE zook_frogsleep_focus_sessions AS duplicate
SET deleted_at = NOW()
FROM frogsleep_focus_session_merge AS mapping
WHERE duplicate.id = mapping.id AND mapping.id <> mapping.keep_id;

CREATE UNIQUE INDEX IF NOT EXISTS idx_frogsleep_focus_sessions_client_uidx
  ON zook_frogsleep_focus_sessions (app_id, owner_user_id, (payload->>'client_session_id'))
  WHERE deleted_at IS NULL AND owner_user_id IS NOT NULL
    AND jsonb_typeof(payload->'client_session_id') = 'string'
    AND length(payload->>'client_session_id') BETWEEN 1 AND 128
    AND btrim(payload->>'client_session_id') <> '';
