-- Additive owner-scoped reading sources, collection receipts and scheduled reading tasks.
-- Application rollback retains user assets. All writes use the existing owner transaction gate.
CREATE TABLE IF NOT EXISTS zook_lighttick_reading_workflow (
 app_id TEXT NOT NULL CHECK(app_id='lighttick'), user_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('source','collection','task')),
 id TEXT NOT NULL CHECK(char_length(id) BETWEEN 1 AND 128),
 data JSONB NOT NULL CHECK(jsonb_typeof(data)='object' AND data->>'id'=id),
 updated_at TIMESTAMPTZ NOT NULL,
 PRIMARY KEY(app_id,user_id,kind,id)
);
CREATE INDEX IF NOT EXISTS zook_lighttick_reading_workflow_owner_idx ON zook_lighttick_reading_workflow(app_id,user_id,kind,updated_at DESC);

CREATE INDEX IF NOT EXISTS zook_lighttick_reading_workflow_date_idx ON zook_lighttick_reading_workflow(app_id,user_id,(data->>'business_date')) WHERE kind='task';
