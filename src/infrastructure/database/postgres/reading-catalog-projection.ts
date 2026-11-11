// The database projects bounded metadata before transfer. Full private/body/material
// fields remain searchable in SQL but never enter the catalog result or API heap.
export const READING_CATALOG_SQL = `jsonb_build_object(
'id',id,'revision',revision,'content_version',payload->'content_version',
 'title',payload->'content'->'title','preview',left(payload->'content'->>'body',160),
 'language',payload->'content'->'language','source_url',payload->'content'->'source_url',
 'published_at',payload->'content'->'published_at','published_date',payload->'content'->'published_date',
 'archived',payload->'archived','bookmark',payload->'personal'->'bookmark',
 'later',payload->'personal'->'later','read',payload->'personal'->'read',
 'has_feedback',length(coalesce(payload->'personal'->>'feedback',''))>0 OR EXISTS(
 SELECT 1 FROM jsonb_each(CASE WHEN jsonb_typeof(payload->'personal'->'structured_feedback')='object'
 THEN payload->'personal'->'structured_feedback' ELSE '{}'::jsonb END) AS f(k,v)
 WHERE k IN ('value','difficulty','takeaway','question','action','tags')
 AND v NOT IN ('""'::jsonb,'[]'::jsonb,'null'::jsonb)),
 'created_at',payload->'created_at','updated_at',payload->'updated_at')`;
