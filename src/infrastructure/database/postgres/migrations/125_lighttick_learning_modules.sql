-- Preserve existing source and quota fields in the canonical column-based module table.
ALTER TABLE zook_lighttick_learning_modules ADD COLUMN IF NOT EXISTS template_id TEXT;
CREATE INDEX IF NOT EXISTS lighttick_collections_module_idx
 ON zook_lighttick_learning_collections(app_id,user_id,module_id,id);

CREATE TABLE IF NOT EXISTS zook_lighttick_learning_module_versions (
 app_id TEXT NOT NULL CHECK(app_id='lighttick'),user_id TEXT NOT NULL,id TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision>0),payload JSONB NOT NULL,
 PRIMARY KEY(app_id,user_id,id,revision),
 FOREIGN KEY(app_id,user_id,id) REFERENCES zook_lighttick_learning_modules(app_id,user_id,id)
);

INSERT INTO zook_lighttick_learning_module_versions(app_id,user_id,id,revision,payload)
SELECT app_id,user_id,id,revision,jsonb_build_object(
 'appId',app_id,'userId',user_id,'id',id,'title',title,'description',description,
 'templateId',template_id,'revision',revision,'archived',NOT enabled,
 'createdAt',to_char(created_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
 'updatedAt',to_char(updated_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
)
FROM zook_lighttick_learning_modules
WHERE id LIKE 'module-%'
ON CONFLICT DO NOTHING;
