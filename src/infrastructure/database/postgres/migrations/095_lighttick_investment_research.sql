CREATE TABLE IF NOT EXISTS zook_lighttick_investment_research (
 app_id TEXT NOT NULL CHECK(app_id='lighttick'), user_id TEXT NOT NULL, id TEXT NOT NULL,
 instrument_id TEXT NOT NULL, account_id TEXT, revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 100),
 payload JSONB NOT NULL CHECK(jsonb_typeof(payload)='object'),
 PRIMARY KEY(app_id,user_id,id),
 FOREIGN KEY(app_id,user_id,instrument_id) REFERENCES zook_lighttick_investment_instruments(app_id,user_id,id),
 FOREIGN KEY(app_id,user_id,account_id) REFERENCES zook_lighttick_investment_accounts(app_id,user_id,id),
 CHECK(payload->>'id' IS NOT DISTINCT FROM id),
 CHECK((payload->>'revision')::integer IS NOT DISTINCT FROM revision),
 CHECK(payload->>'instrument_id' IS NOT DISTINCT FROM instrument_id),
 CHECK(payload->>'account_id' IS NOT DISTINCT FROM account_id)
);
CREATE TABLE IF NOT EXISTS zook_lighttick_investment_research_versions (
 app_id TEXT NOT NULL CHECK(app_id='lighttick'), user_id TEXT NOT NULL, id TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision BETWEEN 1 AND 100), payload JSONB NOT NULL CHECK(jsonb_typeof(payload)='object'),
 PRIMARY KEY(app_id,user_id,id,revision),
 FOREIGN KEY(app_id,user_id,id) REFERENCES zook_lighttick_investment_research(app_id,user_id,id),
 CHECK(payload->>'id' IS NOT DISTINCT FROM id),
 CHECK((payload->>'revision')::integer IS NOT DISTINCT FROM revision)
);
CREATE INDEX IF NOT EXISTS zook_lighttick_research_instrument ON zook_lighttick_investment_research(app_id,user_id,instrument_id,id);
