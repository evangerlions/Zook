-- Backfill preserves the sharing behavior of relationships accepted before directional grants existed.
-- New relationships always create explicit preview-scoped grants during acceptance.
WITH legacy_relationships AS (
  SELECT id, app_id, owner_user_id, partner_user_id, 'sleep'::TEXT AS domain
  FROM zook_frogsleep_sleep_relationships
  WHERE deleted_at IS NULL AND status = 'active'
    AND owner_user_id IS NOT NULL AND partner_user_id IS NOT NULL
  UNION ALL
  SELECT id, app_id, owner_user_id, partner_user_id, 'focus'::TEXT AS domain
  FROM zook_frogsleep_focus_relationships
  WHERE deleted_at IS NULL AND status = 'accepted'
    AND owner_user_id IS NOT NULL AND partner_user_id IS NOT NULL
), directional_pairs AS (
  SELECT id, app_id, domain, owner_user_id AS grantor_user_id, partner_user_id AS grantee_user_id
  FROM legacy_relationships
  UNION ALL
  SELECT id, app_id, domain, partner_user_id AS grantor_user_id, owner_user_id AS grantee_user_id
  FROM legacy_relationships
), grant_rows AS (
  SELECT pairs.*, category
  FROM directional_pairs pairs
  CROSS JOIN (VALUES ('presence'), ('daily_summary'), ('weekly_trend'), ('shared_activity')) categories(category)
)
INSERT INTO zook_frogsleep_buddy_sharing_grants
  (id, app_id, relationship_id, grantor_user_id, grantee_user_id, domain, category,
   state, version, granted_at, created_at, updated_at)
SELECT
  'legacy-' || md5(app_id || ':' || id || ':' || grantor_user_id || ':' || grantee_user_id || ':' || category),
  app_id, id, grantor_user_id, grantee_user_id, domain, category,
  'granted', 1, NOW(), NOW(), NOW()
FROM grant_rows
ON CONFLICT (app_id, relationship_id, grantor_user_id, grantee_user_id, domain, category)
DO NOTHING;

-- Rollback: delete only rows whose deterministic id begins with `legacy-`.
