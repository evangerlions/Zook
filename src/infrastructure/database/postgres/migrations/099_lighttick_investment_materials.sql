CREATE TABLE IF NOT EXISTS zook_lighttick_investment_materials (
 app_id TEXT NOT NULL CHECK(app_id='lighttick'), user_id TEXT NOT NULL, id TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 100),
 payload JSONB NOT NULL CHECK(jsonb_typeof(payload)='object'),
 PRIMARY KEY(app_id,user_id,id),
 CHECK(payload->>'id' IS NOT DISTINCT FROM id),
 CHECK((payload->>'revision')::integer IS NOT DISTINCT FROM revision),
 CHECK(payload->>'content_digest' IS NOT NULL AND payload->>'content_digest' ~ '^[a-f0-9]{64}$'),
 CHECK(jsonb_typeof(payload->'archived') IS NOT DISTINCT FROM 'boolean')
);
CREATE TABLE IF NOT EXISTS zook_lighttick_investment_material_versions (
 app_id TEXT NOT NULL CHECK(app_id='lighttick'), user_id TEXT NOT NULL, id TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 100),
 payload JSONB NOT NULL CHECK(jsonb_typeof(payload)='object'),
 PRIMARY KEY(app_id,user_id,id,revision),
 FOREIGN KEY(app_id,user_id,id) REFERENCES zook_lighttick_investment_materials(app_id,user_id,id),
 CHECK(payload->>'id' IS NOT DISTINCT FROM id),
 CHECK((payload->>'revision')::integer IS NOT DISTINCT FROM revision),
 CHECK(payload->>'content_digest' IS NOT NULL AND payload->>'content_digest' ~ '^[a-f0-9]{64}$'),
 CHECK(jsonb_typeof(payload->'archived') IS NOT DISTINCT FROM 'boolean')
);
