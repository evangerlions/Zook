-- Additive portfolio sources, audited previews and immutable adoptions. Existing financial rows remain intact.
CREATE TABLE IF NOT EXISTS zook_lighttick_portfolio_facts (
 app_id TEXT NOT NULL,user_id TEXT NOT NULL,id TEXT NOT NULL,account_id TEXT NOT NULL,
 kind TEXT NOT NULL CHECK(kind IN ('fund_nav','notice')),instrument_id TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision>0),nav NUMERIC(28,10),payload JSONB NOT NULL,
 PRIMARY KEY(app_id,user_id,id),UNIQUE(app_id,user_id,account_id,id),
 FOREIGN KEY(app_id,user_id,account_id) REFERENCES zook_lighttick_investment_accounts(app_id,user_id,id),
 FOREIGN KEY(app_id,user_id,instrument_id) REFERENCES zook_lighttick_investment_instruments(app_id,user_id,id),
 CHECK((kind='fund_nav' AND nav IS NOT NULL AND nav>0) OR (kind='notice' AND nav IS NULL))
);
CREATE TABLE IF NOT EXISTS zook_lighttick_portfolio_versions (
 app_id TEXT NOT NULL,user_id TEXT NOT NULL,id TEXT NOT NULL,revision INTEGER NOT NULL,
 nav NUMERIC(28,10),payload JSONB NOT NULL,PRIMARY KEY(app_id,user_id,id,revision),
 FOREIGN KEY(app_id,user_id,id) REFERENCES zook_lighttick_portfolio_facts(app_id,user_id,id)
);
CREATE TABLE IF NOT EXISTS zook_lighttick_portfolio_work (
 app_id TEXT NOT NULL,user_id TEXT NOT NULL,id TEXT NOT NULL,account_id TEXT NOT NULL,
 revision INTEGER NOT NULL CHECK(revision>0),status TEXT NOT NULL CHECK(status IN ('queued','running','succeeded','failed','cancelled')),
 lease_until TIMESTAMPTZ,created_at TIMESTAMPTZ NOT NULL,payload JSONB NOT NULL,
 PRIMARY KEY(app_id,user_id,id),UNIQUE(app_id,user_id,account_id,id),
 FOREIGN KEY(app_id,user_id,account_id) REFERENCES zook_lighttick_investment_accounts(app_id,user_id,id)
);
CREATE INDEX IF NOT EXISTS lighttick_portfolio_recovery ON zook_lighttick_portfolio_work(status,lease_until,created_at);
CREATE TABLE IF NOT EXISTS zook_lighttick_portfolio_saved (
 app_id TEXT NOT NULL,user_id TEXT NOT NULL,id TEXT NOT NULL,account_id TEXT NOT NULL,
 work_id TEXT NOT NULL,kind TEXT NOT NULL CHECK(kind IN ('valuation','baseline')),created_at TIMESTAMPTZ NOT NULL,payload JSONB NOT NULL,
 PRIMARY KEY(app_id,user_id,id),UNIQUE(app_id,user_id,work_id),
 FOREIGN KEY(app_id,user_id,account_id,work_id) REFERENCES zook_lighttick_portfolio_work(app_id,user_id,account_id,id)
);
