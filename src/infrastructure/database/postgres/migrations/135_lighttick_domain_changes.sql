-- Shared log, metadata hints only; legacy task sync continues its existing protocol.
CREATE UNIQUE INDEX IF NOT EXISTS lighttick_domain_change_once
 ON zook_lighttick_change_log(app_id,user_id,entity_id,entity_version,operation) WHERE entity_type='domain';
CREATE INDEX IF NOT EXISTS lighttick_domain_changes_owner
 ON zook_lighttick_change_log(app_id,user_id,sequence) WHERE entity_type='domain';
CREATE INDEX IF NOT EXISTS lighttick_domain_changes_scope
 ON zook_lighttick_change_log(app_id,user_id,(snapshot->>'domain'),sequence) WHERE entity_type='domain';
CREATE INDEX IF NOT EXISTS lighttick_legacy_changes_owner
 ON zook_lighttick_change_log(app_id,user_id,sequence) WHERE entity_type<>'domain';
