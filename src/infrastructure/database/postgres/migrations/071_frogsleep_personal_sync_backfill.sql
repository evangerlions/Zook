-- Preserve old row IDs in an audit-only alias map. Different bodies remain separate conflict resources.
CREATE TABLE IF NOT EXISTS zook_frogsleep_personal_legacy_aliases (
  app_id TEXT NOT NULL, user_id TEXT NOT NULL, old_id TEXT NOT NULL, kind TEXT NOT NULL,
  resource_id TEXT NOT NULL, conflicting BOOLEAN NOT NULL,
  PRIMARY KEY(app_id,user_id,old_id),
  FOREIGN KEY(app_id,user_id) REFERENCES zook_frogsleep_personal_sync_state(app_id,user_id) ON DELETE CASCADE
);
INSERT INTO zook_frogsleep_personal_sync_state(app_id,user_id)
SELECT DISTINCT s.app_id,s.owner_user_id FROM zook_frogsleep_sleep_report_snapshots s
JOIN zook_app_users u ON u.app_id=s.app_id AND u.user_id=s.owner_user_id AND u.status='ACTIVE'
WHERE s.app_id='frogsleep' AND s.deleted_at IS NULL
UNION
SELECT DISTINCT s.app_id,s.owner_user_id FROM zook_frogsleep_progress_snapshots s
JOIN zook_app_users u ON u.app_id=s.app_id AND u.user_id=s.owner_user_id AND u.status='ACTIVE'
WHERE s.app_id='frogsleep' AND s.deleted_at IS NULL AND s.payload->>'namespace'='report_preferences'
ON CONFLICT DO NOTHING;

SELECT user_id FROM zook_frogsleep_personal_sync_state WHERE app_id='frogsleep' ORDER BY user_id FOR UPDATE;

CREATE TEMP TABLE frogsleep_sync_backfill ON COMMIT DROP AS
WITH old AS (
 SELECT s.app_id,s.owner_user_id user_id,s.id old_id,'sleep_report'::text kind,
   COALESCE(NULLIF(s.payload->>'snapshot_id',''),s.id) logical_id,
   jsonb_build_object('snapshot_id',COALESCE(NULLIF(s.payload->>'snapshot_id',''),s.id),
     'report_id',COALESCE(s.payload->>'report_id',s.payload->>'snapshot_id',s.id),
     'schema_version',s.payload->>'schema_version','recorded_at',s.payload->>'recorded_at',
     'date_anchor',s.payload->>'date_anchor','report_type',COALESCE(s.payload->>'report_type','sleep_report'),'data',COALESCE(s.payload->'data','{}'::jsonb)) data,
   s.created_at,s.updated_at
 FROM zook_frogsleep_sleep_report_snapshots s JOIN zook_frogsleep_personal_sync_state st ON st.app_id=s.app_id AND st.user_id=s.owner_user_id AND NOT st.deleted
 WHERE s.app_id='frogsleep' AND s.deleted_at IS NULL
 UNION ALL
 SELECT s.app_id,s.owner_user_id,s.id,'report_preferences','report_preferences',s.payload,s.created_at,s.updated_at
 FROM zook_frogsleep_progress_snapshots s JOIN zook_frogsleep_personal_sync_state st ON st.app_id=s.app_id AND st.user_id=s.owner_user_id AND NOT st.deleted
 WHERE s.app_id='frogsleep' AND s.deleted_at IS NULL AND s.payload->>'namespace'='report_preferences'
), bodies AS (
 SELECT DISTINCT ON(app_id,user_id,kind,logical_id,data) * FROM old ORDER BY app_id,user_id,kind,logical_id,data,created_at,old_id
), named AS (
 SELECT *, row_number() OVER(PARTITION BY app_id,user_id,kind,logical_id ORDER BY created_at,old_id) variant FROM bodies
), aliases AS (
 SELECT o.*,CASE WHEN n.variant=1 OR n.kind='report_preferences' THEN n.logical_id ELSE '__legacy_conflict__:'||n.old_id END resource_id,
 n.variant>1 conflicting,n.old_id canonical_old_id
 FROM old o JOIN named n USING(app_id,user_id,kind,logical_id,data)
)
SELECT * FROM aliases;

INSERT INTO zook_frogsleep_personal_legacy_aliases(app_id,user_id,old_id,kind,resource_id,conflicting)
SELECT app_id,user_id,old_id,kind,resource_id,conflicting FROM frogsleep_sync_backfill ON CONFLICT DO NOTHING;
WITH canonical AS (
 SELECT DISTINCT ON(app_id,user_id,kind,resource_id) * FROM frogsleep_sync_backfill b
 WHERE NOT EXISTS(SELECT 1 FROM zook_frogsleep_personal_versions v WHERE v.app_id=b.app_id AND v.user_id=b.user_id AND v.kind=b.kind AND v.resource_id=b.resource_id)
 ORDER BY app_id,user_id,kind,resource_id,updated_at DESC,old_id DESC
), sequenced AS (
 SELECT c.*,st.sequence + row_number() OVER(PARTITION BY c.app_id,c.user_id ORDER BY c.created_at,c.old_id) seq
 FROM canonical c JOIN zook_frogsleep_personal_sync_state st USING(app_id,user_id)
)
INSERT INTO zook_frogsleep_personal_versions(app_id,user_id,kind,resource_id,sequence,document)
SELECT app_id,user_id,kind,resource_id,seq,jsonb_build_object('kind',kind,'id',resource_id,'revision',1,'sequence',seq,'deleted',FALSE,'data',data,'created_at',to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),'updated_at',to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')) FROM sequenced;
UPDATE zook_frogsleep_personal_sync_state s SET sequence=(SELECT COALESCE(max(v.sequence),0) FROM zook_frogsleep_personal_versions v WHERE v.app_id=s.app_id AND v.user_id=s.user_id)
WHERE s.app_id='frogsleep';
