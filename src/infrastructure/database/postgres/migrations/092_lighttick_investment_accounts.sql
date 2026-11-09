CREATE TABLE IF NOT EXISTS zook_lighttick_investment_instruments (
 app_id TEXT NOT NULL CHECK(app_id='lighttick'),user_id TEXT NOT NULL,id TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision>0),market TEXT NOT NULL CHECK(market IN ('SSE','SZSE','BSE','FUND')),code TEXT NOT NULL,
 payload JSONB NOT NULL CHECK(jsonb_typeof(payload)='object'),PRIMARY KEY(app_id,user_id,id),UNIQUE(app_id,user_id,market,code)
);
CREATE TABLE IF NOT EXISTS zook_lighttick_investment_accounts (
 app_id TEXT NOT NULL CHECK(app_id='lighttick'),user_id TEXT NOT NULL,id TEXT NOT NULL,revision INTEGER NOT NULL CHECK(revision>0),
 baseline_version INTEGER NOT NULL CHECK(baseline_version>0),archived BOOLEAN NOT NULL DEFAULT FALSE,created_at TIMESTAMPTZ NOT NULL,updated_at TIMESTAMPTZ NOT NULL,
 PRIMARY KEY(app_id,user_id,id)
);
CREATE TABLE IF NOT EXISTS zook_lighttick_investment_baselines (
 app_id TEXT NOT NULL CHECK(app_id='lighttick'),user_id TEXT NOT NULL,account_id TEXT NOT NULL,version INTEGER NOT NULL CHECK(version>0),
 name TEXT NOT NULL,currency TEXT NOT NULL CHECK(currency='CNY'),baseline_date DATE NOT NULL,opening_cash NUMERIC(28,10) NOT NULL CHECK(opening_cash>=0),
 PRIMARY KEY(app_id,user_id,account_id,version),FOREIGN KEY(app_id,user_id,account_id) REFERENCES zook_lighttick_investment_accounts(app_id,user_id,id)
);
CREATE TABLE IF NOT EXISTS zook_lighttick_investment_openings (
 app_id TEXT NOT NULL CHECK(app_id='lighttick'),user_id TEXT NOT NULL,account_id TEXT NOT NULL,baseline_version INTEGER NOT NULL,instrument_id TEXT NOT NULL,
 quantity NUMERIC(28,10) NOT NULL CHECK(quantity>0),cost NUMERIC(28,10) CHECK(cost>=0),
 PRIMARY KEY(app_id,user_id,account_id,baseline_version,instrument_id),
 FOREIGN KEY(app_id,user_id,account_id,baseline_version) REFERENCES zook_lighttick_investment_baselines(app_id,user_id,account_id,version),
 FOREIGN KEY(app_id,user_id,instrument_id) REFERENCES zook_lighttick_investment_instruments(app_id,user_id,id)
);
DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='lighttick_investment_current_baseline') THEN
  ALTER TABLE zook_lighttick_investment_accounts ADD CONSTRAINT lighttick_investment_current_baseline FOREIGN KEY(app_id,user_id,id,baseline_version)
   REFERENCES zook_lighttick_investment_baselines(app_id,user_id,account_id,version) DEFERRABLE INITIALLY DEFERRED;
 END IF;
END $$;

DO $$ BEGIN
 IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conname='lighttick_investment_instrument_identity') THEN
  ALTER TABLE zook_lighttick_investment_instruments ADD CONSTRAINT lighttick_investment_instrument_identity CHECK(COALESCE(
   payload->>'id'=id AND (payload->>'revision')::integer=revision AND payload->>'market'=market AND payload->>'code'=code
   AND code ~ '^[A-Z0-9_.-]{1,32}$' AND payload->>'kind' IN ('stock','etf','fund') AND (market='FUND')=(payload->>'kind'='fund'),FALSE));
 END IF;
END $$;
