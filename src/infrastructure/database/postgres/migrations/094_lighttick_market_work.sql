CREATE TABLE IF NOT EXISTS zook_lighttick_market_work (
 app_id TEXT NOT NULL CHECK(app_id='lighttick'),user_id TEXT NOT NULL,id TEXT NOT NULL,instrument_id TEXT NOT NULL,revision INTEGER NOT NULL CHECK(revision>0),
 status TEXT NOT NULL CHECK(status IN ('queued','running','succeeded','failed','cancelled')),lease_until TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL,payload JSONB NOT NULL,
 PRIMARY KEY(app_id,user_id,id),FOREIGN KEY(app_id,user_id,instrument_id) REFERENCES zook_lighttick_investment_instruments(app_id,user_id,id),
 CHECK(COALESCE(payload->>'id'=id AND payload->>'instrument_id'=instrument_id AND payload->>'appId'=app_id AND payload->>'userId'=user_id AND payload->>'status'=status AND (payload->>'revision')::integer=revision,FALSE))
);
CREATE INDEX IF NOT EXISTS lighttick_market_work_recovery ON zook_lighttick_market_work(status,lease_until,created_at) WHERE status IN ('queued','running');
CREATE TABLE IF NOT EXISTS zook_lighttick_market_snapshots (
 app_id TEXT NOT NULL CHECK(app_id='lighttick'),user_id TEXT NOT NULL,id TEXT NOT NULL,instrument_id TEXT NOT NULL,work_id TEXT NOT NULL,payload JSONB NOT NULL,summary JSONB NOT NULL,
 PRIMARY KEY(app_id,user_id,id),UNIQUE(app_id,user_id,work_id),
 FOREIGN KEY(app_id,user_id,instrument_id) REFERENCES zook_lighttick_investment_instruments(app_id,user_id,id),
 FOREIGN KEY(app_id,user_id,work_id) REFERENCES zook_lighttick_market_work(app_id,user_id,id),
 CHECK(COALESCE(payload->>'id'=id AND payload->>'instrument_id'=instrument_id AND payload->>'work_id'=work_id AND (payload->>'revision')::integer=1 AND NOT(payload->'dataset'?'bars'),FALSE))
);
CREATE TABLE IF NOT EXISTS zook_lighttick_market_bars (
 app_id TEXT NOT NULL CHECK(app_id='lighttick'),user_id TEXT NOT NULL,snapshot_id TEXT NOT NULL,business_date DATE NOT NULL,
 open NUMERIC(28,10) NOT NULL CHECK(open>0),high NUMERIC(28,10) NOT NULL CHECK(high>0),low NUMERIC(28,10) NOT NULL CHECK(low>0),close NUMERIC(28,10) NOT NULL CHECK(close>0),
 volume_shares NUMERIC(28,10) NOT NULL CHECK(volume_shares>=0),amount_cny NUMERIC(28,10) NOT NULL CHECK(amount_cny>=0),turnover_rate_pct NUMERIC(28,10) CHECK(turnover_rate_pct>=0),
 PRIMARY KEY(app_id,user_id,snapshot_id,business_date),FOREIGN KEY(app_id,user_id,snapshot_id) REFERENCES zook_lighttick_market_snapshots(app_id,user_id,id),
 CHECK(low<=LEAST(open,close) AND high>=GREATEST(open,close))
);
