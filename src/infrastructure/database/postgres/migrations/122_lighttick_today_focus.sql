-- One explicit focus choice per owner/business date; task lifecycle remains canonical.
CREATE TABLE IF NOT EXISTS zook_lighttick_today_focus (
 app_id TEXT NOT NULL CHECK(app_id='lighttick'),user_id TEXT NOT NULL,business_date DATE NOT NULL,
 revision INTEGER NOT NULL CHECK(revision>0),data JSONB NOT NULL,
 PRIMARY KEY(app_id,user_id,business_date),
 CHECK(jsonb_typeof(data)='object' AND (data->>'revision')::int=revision AND data->>'business_date'=business_date::text)
);
