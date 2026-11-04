CREATE TABLE IF NOT EXISTS zook_lighttick_investment_ledger_work (
 app_id TEXT NOT NULL CHECK(app_id='lighttick'),user_id TEXT NOT NULL,id TEXT NOT NULL,account_id TEXT NOT NULL,revision INTEGER NOT NULL CHECK(revision>0),
 status TEXT NOT NULL CHECK(status IN ('queued','running','succeeded','failed','cancelled')),lease_until TIMESTAMPTZ,payload JSONB NOT NULL,
 PRIMARY KEY(app_id,user_id,id),FOREIGN KEY(app_id,user_id,account_id) REFERENCES zook_lighttick_investment_accounts(app_id,user_id,id),
 CHECK(COALESCE(payload->>'id'=id AND payload->>'account_id'=account_id AND payload->>'appId'=app_id AND payload->>'userId'=user_id AND payload->>'status'=status AND (payload->>'revision')::integer=revision,FALSE))
);
CREATE INDEX IF NOT EXISTS lighttick_investment_work_recovery ON zook_lighttick_investment_ledger_work(status,lease_until) WHERE status IN ('queued','running');
CREATE TABLE IF NOT EXISTS zook_lighttick_investment_events (
 app_id TEXT NOT NULL CHECK(app_id='lighttick'),user_id TEXT NOT NULL,account_id TEXT NOT NULL,id TEXT NOT NULL,sequence INTEGER NOT NULL CHECK(sequence>1),
 business_date DATE NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('fill','cash')),instrument_id TEXT,side TEXT CHECK(side IN ('buy','sell')),cash_kind TEXT,
 price NUMERIC(28,10) CHECK(price>0),quantity NUMERIC(28,10) CHECK(quantity>0),fee NUMERIC(28,10) CHECK(fee>=0),tax NUMERIC(28,10) CHECK(tax>=0),
 settlement_amount NUMERIC(28,10) CHECK(settlement_amount>=0),amount NUMERIC(28,10) CHECK(amount>0),source TEXT,created_at TIMESTAMPTZ NOT NULL,
 PRIMARY KEY(app_id,user_id,id),UNIQUE(app_id,user_id,account_id,sequence),
 FOREIGN KEY(app_id,user_id,account_id) REFERENCES zook_lighttick_investment_accounts(app_id,user_id,id),
 FOREIGN KEY(app_id,user_id,instrument_id) REFERENCES zook_lighttick_investment_instruments(app_id,user_id,id),
 FOREIGN KEY(app_id,user_id,id) REFERENCES zook_lighttick_investment_ledger_work(app_id,user_id,id),
 CHECK(COALESCE((kind='fill' AND instrument_id IS NOT NULL AND side IS NOT NULL AND price IS NOT NULL AND quantity IS NOT NULL AND cash_kind IS NULL AND amount IS NULL AND source IN ('manual','csv','broker','fund_confirmation')) OR
 (kind='cash' AND cash_kind IN ('deposit','withdrawal','dividend','interest','fee','fund_receivable_hold','fund_receivable_release') AND amount IS NOT NULL AND instrument_id IS NULL AND side IS NULL AND price IS NULL AND quantity IS NULL AND fee IS NULL AND tax IS NULL AND settlement_amount IS NULL AND source IS NULL),FALSE))
);
