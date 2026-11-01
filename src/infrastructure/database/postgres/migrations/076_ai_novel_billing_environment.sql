DO $$
BEGIN
IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema=current_schema()
  AND table_name='zook_ai_novel_billing_memberships' AND column_name='environment') THEN RETURN; END IF;
-- Keep the canonical membership/credit stores, with independent environment keys.
ALTER TABLE zook_ai_novel_billing_memberships ADD COLUMN environment text NOT NULL DEFAULT 'production'
  CHECK (environment IN ('sandbox','production'));
UPDATE zook_ai_novel_billing_memberships m SET environment='sandbox'
WHERE EXISTS (SELECT 1 FROM zook_ai_novel_billing_transactions t WHERE t.app_id=m.app_id AND t.user_id=m.user_id
  AND t.source=m.source AND t.product_key=m.plan_key AND t.is_sandbox=true
  AND t.status IN ('provider_paid','entitlement_active') AND t.expires_at >= m.expires_at)
AND NOT EXISTS (SELECT 1 FROM zook_ai_novel_billing_transactions t WHERE t.app_id=m.app_id AND t.user_id=m.user_id
  AND t.source=m.source AND t.product_key=m.plan_key AND t.is_sandbox=false
  AND t.status IN ('provider_paid','entitlement_active') AND t.expires_at >= m.expires_at);
-- Unknown legacy provenance must be re-synchronized before granting access.
-- Retain identity/source/expiry for diagnosis; never infer production from unknown.
UPDATE zook_ai_novel_billing_memberships m SET active=false,state='expired'
WHERE m.active AND NOT EXISTS (SELECT 1 FROM zook_ai_novel_billing_transactions t
  WHERE t.app_id=m.app_id AND t.user_id=m.user_id AND t.source=m.source AND t.product_key=m.plan_key
    AND t.is_sandbox=(m.environment='sandbox') AND t.status IN ('provider_paid','entitlement_active')
    AND t.expires_at >= m.expires_at);
ALTER TABLE zook_ai_novel_billing_memberships DROP CONSTRAINT zook_ai_novel_billing_memberships_pkey;
ALTER TABLE zook_ai_novel_billing_memberships ADD PRIMARY KEY(app_id,user_id,environment);

ALTER TABLE zook_ai_novel_credit_accounts ADD COLUMN environment text NOT NULL DEFAULT 'production' CHECK(environment IN ('sandbox','production'));
ALTER TABLE zook_ai_novel_credit_jobs ADD COLUMN environment text NOT NULL DEFAULT 'production' CHECK(environment IN ('sandbox','production'));
ALTER TABLE zook_ai_novel_credit_events ADD COLUMN environment text NOT NULL DEFAULT 'production' CHECK(environment IN ('sandbox','production'));
ALTER TABLE zook_ai_novel_credit_windows ADD COLUMN environment text NOT NULL DEFAULT 'production' CHECK(environment IN ('sandbox','production'));
ALTER TABLE zook_ai_novel_credit_jobs DROP CONSTRAINT zook_ai_novel_credit_jobs_user_id_fkey;
-- Accounts with sandbox-only provenance (including expired/free balances with gifts)
-- stay sandbox; never carry historical sandbox gifts into production.
UPDATE zook_ai_novel_credit_accounts a SET environment='sandbox' WHERE EXISTS(SELECT 1 FROM zook_ai_novel_billing_memberships m WHERE m.user_id=a.user_id AND m.environment='sandbox')
  AND NOT EXISTS(SELECT 1 FROM zook_ai_novel_billing_memberships m WHERE m.user_id=a.user_id AND m.environment='production' AND m.active);
UPDATE zook_ai_novel_credit_jobs j SET environment=a.environment FROM zook_ai_novel_credit_accounts a WHERE j.user_id=a.user_id;
UPDATE zook_ai_novel_credit_events e SET environment=a.environment FROM zook_ai_novel_credit_accounts a WHERE e.user_id=a.user_id;
UPDATE zook_ai_novel_credit_windows w SET environment=a.environment FROM zook_ai_novel_credit_accounts a WHERE w.user_id=a.user_id;
ALTER TABLE zook_ai_novel_credit_accounts DROP CONSTRAINT zook_ai_novel_credit_accounts_pkey;
ALTER TABLE zook_ai_novel_credit_accounts ADD PRIMARY KEY(user_id,environment);
ALTER TABLE zook_ai_novel_credit_jobs DROP CONSTRAINT zook_ai_novel_credit_jobs_pkey;
ALTER TABLE zook_ai_novel_credit_jobs ADD PRIMARY KEY(user_id,environment,job_id);
ALTER TABLE zook_ai_novel_credit_jobs ADD FOREIGN KEY(user_id,environment) REFERENCES zook_ai_novel_credit_accounts(user_id,environment) ON DELETE CASCADE;
ALTER TABLE zook_ai_novel_credit_events DROP CONSTRAINT zook_ai_novel_credit_events_pkey;
ALTER TABLE zook_ai_novel_credit_events ADD PRIMARY KEY(user_id,environment,event_id);
ALTER TABLE zook_ai_novel_credit_windows DROP CONSTRAINT zook_ai_novel_credit_windows_pkey;
ALTER TABLE zook_ai_novel_credit_windows ADD PRIMARY KEY(user_id,environment,period_key);


-- Receipt IDs from different provider environments must never merge financially.
ALTER TABLE zook_ai_novel_billing_transactions ADD COLUMN environment text GENERATED ALWAYS AS
  (CASE WHEN is_sandbox=true THEN 'sandbox' WHEN is_sandbox=false THEN 'production' ELSE 'unknown' END) STORED;
ALTER TABLE zook_ai_novel_billing_transactions DROP CONSTRAINT zook_ai_novel_billing_transactions_pkey;
ALTER TABLE zook_ai_novel_billing_transactions ADD PRIMARY KEY(app_id,user_id,provider_transaction_id,environment);

END $$;
