import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { inBillingEnvironment, billingEnvironment } from '../../src/modules/billing/billing-environment.ts';
import { PostgresAiNovelBillingStore } from '../../src/infrastructure/database/postgres/postgres-ainovel-billing.ts';
import { PostgresAiNovelCreditsStore } from '../../src/infrastructure/database/postgres/postgres-ai-novel-credits.ts';
import { AiNovelCreditsService } from '../../src/modules/ai-novel/credits/ai-novel-credits.service.ts';

const url = process.env.BILLING_TEST_DATABASE_URL;
test('PostgreSQL legacy upgrade and canonical stores isolate both billing environments', { skip: !url }, async () => {
  const schema = 'billing_env_' + randomUUID().replaceAll('-', '');
  const root = new Pool({ connectionString: url });
  const pool = new Pool({ connectionString: url, options: `-c search_path=${schema}` });
  try {
    await root.query(`CREATE SCHEMA ${schema}`);
    for (const name of ['067_ai_novel_billing_revenuecat.sql', '071_ai_novel_alipay_orders.sql',
      '072_ai_novel_credits.sql', '074_ai_novel_credit_window_anchor.sql', '075_ai_novel_usage_reporting.sql']) {
      await pool.query(await readFile(new URL('../../src/infrastructure/database/postgres/migrations/' + name, import.meta.url), 'utf8'));
    }
    await pool.query(`INSERT INTO zook_ai_novel_billing_memberships(app_id,user_id,active,state,tier,plan_key,source,expires_at,last_synced_at)
      VALUES('ai_novel','legacy_sandbox',true,'active','plus','plus_yearly','alipay','2099-01-01',now()),
      ('ai_novel','unknown',true,'active','plus','plus_yearly','alipay','2099-01-01',now())`);
    await pool.query(`INSERT INTO zook_ai_novel_billing_transactions(app_id,user_id,provider,provider_transaction_id,product_id,product_key,source,status,is_sandbox,expires_at,observed_at)
      VALUES('ai_novel','legacy_sandbox','alipay','receipt','plus_yearly','plus_yearly','alipay','provider_paid',true,'2099-01-01',now())`);
    await pool.query(`INSERT INTO zook_ai_novel_credit_accounts(user_id,payload) VALUES('legacy_sandbox','{"tier":"free","giftMicros":"1000000"}')`);
    await pool.query(await readFile(new URL('../../src/infrastructure/database/postgres/migrations/076_ai_novel_billing_environment.sql', import.meta.url), 'utf8'));
    // Startup migration runner re-applies idempotent migrations.
    await pool.query(await readFile(new URL('../../src/infrastructure/database/postgres/migrations/076_ai_novel_billing_environment.sql', import.meta.url), 'utf8'));
    await pool.query(await readFile(new URL('../../src/infrastructure/database/postgres/migrations/077_ai_novel_billing_market.sql', import.meta.url), 'utf8'));
    const store = new PostgresAiNovelBillingStore((sql, values) => pool.query(sql, values));
    assert.equal(await store.findMembership('ai_novel','legacy_sandbox'), undefined);
    assert.equal((await inBillingEnvironment('sandbox',()=>store.findMembership('ai_novel','legacy_sandbox')))?.active,true);
    assert.equal((await store.findMembership('ai_novel','unknown'))?.active,false);
    assert.deepEqual((await pool.query('SELECT environment FROM zook_ai_novel_credit_accounts')).rows,[{environment:'sandbox'}]);
    const member = (await inBillingEnvironment('sandbox',()=>store.findMembership('ai_novel','legacy_sandbox')))!;
    await store.upsertMembership({...member, environment:'production', tier:'pro', planKey:'pro_yearly'});
    assert.equal((await store.findMembership('ai_novel','legacy_sandbox'))?.tier,'pro');
    assert.equal((await inBillingEnvironment('sandbox',()=>store.findMembership('ai_novel','legacy_sandbox')))?.tier,'plus');
    const tx = (await pool.query('SELECT * FROM zook_ai_novel_billing_transactions')).rows[0];
    await store.upsertTransaction({appId:'ai_novel',userId:'legacy_sandbox',provider:'alipay',providerTransactionId:'receipt',productId:'plus_yearly',productKey:'plus_yearly',source:'alipay',status:'provider_paid',isSandbox:false,expiresAt:'2099-01-01T00:00:00Z',observedAt:new Date().toISOString(),accountDeletedAt:null});
    assert.equal(tx.environment,'sandbox');
    assert.equal((await pool.query('SELECT * FROM zook_ai_novel_billing_transactions')).rowCount,2);
    const creditStore = new PostgresAiNovelCreditsStore(()=>pool.connect());
    const credits = new AiNovelCreditsService(creditStore, async()=>billingEnvironment()==='sandbox'?'pro':'free');
    await inBillingEnvironment('sandbox',async()=>{
      assert.equal((await credits.balance('new_user')).periodicLimit,4000);
      assert.equal(await credits.begin('new_user','same_job','sandbox_request'),'allowed');
    });
    assert.equal((await credits.balance('new_user')).periodicLimit,200);
    assert.equal(await credits.begin('new_user','same_job','production_request'),'allowed');
    await credits.balance('new_user');
    await creditStore.readUsageReport({from:'2026-01-01T00:00:00Z',to:'2100-01-01T00:00:00Z',userId:'new_user'});
    assert.equal((await pool.query("SELECT * FROM zook_ai_novel_credit_jobs WHERE user_id='new_user'")).rowCount,2);
  } finally {
    await pool.end();
    await root.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);
    await root.end();
  }
});
