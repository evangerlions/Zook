-- Minimal immutable owner tombstones prevent replay from restoring erased identities.
CREATE TABLE IF NOT EXISTS zook_lighttick_reading_tombstones (
 app_id TEXT NOT NULL CHECK(app_id='lighttick'), user_id TEXT NOT NULL, id TEXT NOT NULL,
 payload JSONB NOT NULL CHECK(jsonb_typeof(payload)='object'), PRIMARY KEY(app_id,user_id,id)
);
CREATE INDEX IF NOT EXISTS lighttick_reading_tombstone_content ON zook_lighttick_reading_tombstones(app_id,user_id,(payload->>'content_version'));
