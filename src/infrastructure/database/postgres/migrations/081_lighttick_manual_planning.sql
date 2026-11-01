-- Unknown effort is a real state; existing positive estimates and task facts are retained.
ALTER TABLE zook_lighttick_tasks ALTER COLUMN estimated_minutes DROP NOT NULL;
-- Source proof is never persisted. A deleted claim retains only an opaque tombstone,
-- preventing a copied old local file from resurrecting deleted product data.
CREATE TABLE IF NOT EXISTS zook_lighttick_local_claims (
 source_hash TEXT PRIMARY KEY,
 app_id TEXT NOT NULL CHECK (app_id='lighttick'),
 user_id TEXT,
 entity_type TEXT NOT NULL,
 cloud_id TEXT,
 payload_hash TEXT,
 source_payload JSONB NOT NULL DEFAULT '{}',
 deleted BOOLEAN NOT NULL DEFAULT FALSE,
 created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS zook_lighttick_local_claims_owner ON zook_lighttick_local_claims(app_id,user_id);
