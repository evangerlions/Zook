-- 106/107 are reserved by the independent-reading migration branch.
-- Modules classify existing collections; publications/private state keep their identities.
CREATE TABLE IF NOT EXISTS zook_lighttick_learning_modules (
 app_id TEXT NOT NULL CHECK(app_id='lighttick'),user_id TEXT NOT NULL,id TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision>0),payload JSONB NOT NULL CHECK(jsonb_typeof(payload)='object'),
 PRIMARY KEY(app_id,user_id,id)
);
ALTER TABLE zook_lighttick_learning_collections ADD COLUMN IF NOT EXISTS module_id TEXT;
ALTER TABLE zook_lighttick_learning_collections ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '';
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='lighttick_collection_module_owner_fk' AND conrelid='zook_lighttick_learning_collections'::regclass) THEN
  ALTER TABLE zook_lighttick_learning_collections ADD CONSTRAINT lighttick_collection_module_owner_fk
   FOREIGN KEY(app_id,user_id,module_id) REFERENCES zook_lighttick_learning_modules(app_id,user_id,id);
 END IF;
END $$;
CREATE INDEX IF NOT EXISTS lighttick_collections_module_idx ON zook_lighttick_learning_collections(app_id,user_id,module_id,id);

CREATE TABLE IF NOT EXISTS zook_lighttick_learning_module_versions (
 app_id TEXT NOT NULL CHECK(app_id='lighttick'),user_id TEXT NOT NULL,id TEXT NOT NULL,revision INTEGER NOT NULL CHECK(revision>0),payload JSONB NOT NULL,
 PRIMARY KEY(app_id,user_id,id,revision),FOREIGN KEY(app_id,user_id,id) REFERENCES zook_lighttick_learning_modules(app_id,user_id,id)
);
