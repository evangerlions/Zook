-- Client journals session creation before HTTP. Tombstones make lost/late bearer responses revocable.
ALTER TABLE zook_yaohezi_health_sessions ADD COLUMN IF NOT EXISTS creation_operation_id UUID;
CREATE UNIQUE INDEX IF NOT EXISTS zook_yaohezi_health_session_creation
  ON zook_yaohezi_health_sessions(subject_id,device_id,creation_operation_id) WHERE creation_operation_id IS NOT NULL;
CREATE TABLE IF NOT EXISTS zook_yaohezi_closed_session_creations (
  subject_id UUID NOT NULL, device_id UUID NOT NULL, creation_operation_id UUID NOT NULL,
  closed_at TIMESTAMPTZ NOT NULL DEFAULT now(), PRIMARY KEY(subject_id,device_id,creation_operation_id),
  FOREIGN KEY(subject_id,device_id) REFERENCES zook_yaohezi_health_grants(subject_id,device_id) ON DELETE RESTRICT
);
