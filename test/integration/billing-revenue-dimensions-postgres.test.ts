import assert from 'node:assert/strict';
import test from 'node:test';
import { randomUUID } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { Pool } from 'pg';
import { queryBillingRevenue } from '../../src/infrastructure/database/postgres/postgres-billing-admin.ts';
import type { BillingRevenueDimension } from '../../src/shared/types/billing-admin.ts';

const url=process.env.BILLING_TEST_DATABASE_URL;
test('PostgreSQL groups purchases and cross-day refunds by selected product and source dimensions', {skip:!url}, async()=>{
  const schema='revenue_dimensions_'+randomUUID().replaceAll('-','');
  const root=new Pool({connectionString:url});
  const pool=new Pool({connectionString:url,options:`-c search_path=${schema}`});
  try{
    await root.query(`CREATE SCHEMA ${schema}`);
    await pool.query(await readFile(new URL('../../src/infrastructure/database/postgres/migrations/067_ai_novel_billing_revenuecat.sql',import.meta.url),'utf8'));
    await pool.query(await readFile(new URL('../../src/infrastructure/database/postgres/migrations/071_ai_novel_alipay_orders.sql',import.meta.url),'utf8'));
    await pool.query(`INSERT INTO zook_ai_novel_billing_transactions(app_id,user_id,provider,provider_transaction_id,product_id,product_key,source,status,is_sandbox,distribution,observed_at)
      VALUES('ai_novel','legacy','revenuecat','legacy_store','plus_monthly','plus_monthly','app_store','unknown',true,null,now()),
      ('ai_novel','legacy','alipay','legacy_unknown','plus_monthly','plus_monthly','alipay','unknown',true,'china_android_store',now()),
      ('ai_novel','legacy','alipay','legacy_direct','plus_monthly','plus_monthly','alipay','unknown',true,'web',now())`);
    await pool.query(await readFile(new URL('../../src/infrastructure/database/postgres/migrations/077_ai_novel_billing_market.sql',import.meta.url),'utf8'));
    const legacy=(await pool.query("SELECT provider_transaction_id,market FROM zook_ai_novel_billing_transactions WHERE user_id='legacy' ORDER BY provider_transaction_id")).rows;
    assert.deepEqual(legacy,[{provider_transaction_id:'legacy_direct',market:'direct'},{provider_transaction_id:'legacy_store',market:'app_store'},{provider_transaction_id:'legacy_unknown',market:null}]);
    await pool.query(await readFile(new URL('../../src/infrastructure/database/postgres/migrations/077_ai_novel_billing_market.sql',import.meta.url),'utf8'));
    for(const product of ['plus_monthly','pro_yearly']) for(const source of ['app_store','play_store']){
      await pool.query(`INSERT INTO zook_ai_novel_billing_transactions(app_id,user_id,provider,provider_transaction_id,
        product_id,product_key,source,market,status,purchased_at,refunded_at,amount_minor,refund_amount_minor,currency,is_sandbox,observed_at)
        VALUES('ai_novel','user','revenuecat',$1,$2,$2,$3,CASE WHEN $3='app_store' THEN 'app_store' ELSE 'google_play' END,'provider_paid','2026-10-10T00:00:00Z','2026-10-11T00:00:00Z',100,20,'CNY',true,now())`,[product+source,product,source]);
    }
    const base={from:'2026-10-01T00:00:00Z',to:'2026-11-01T00:00:00Z',sandbox:true};
    const query=(sql:string,values:unknown[])=>pool.query(sql,values);
    const combinations:BillingRevenueDimension[][]=[['appId'],['appId','productKey'],['source'],['productKey'],['appId','source'],['productKey','source'],['appId','productKey','source']];
    for(const groupBy of combinations){
      const rows=await queryBillingRevenue(query,{...base,groupBy});
      const splits=groupBy.includes('productKey')&&groupBy.includes('source')?4:groupBy.includes('productKey')||groupBy.includes('source')?2:1;
      assert.equal(rows.length,splits*2);
      assert.equal(rows.reduce((sum,row)=>sum+row.grossMinor,0),400);
      assert.equal(rows.reduce((sum,row)=>sum+row.refundMinor,0),80);
      assert.equal(rows.reduce((sum,row)=>sum+row.purchaseCount,0),4);
      assert.ok(rows.filter(row=>row.refundMinor>0).every(row=>row.date==='2026-10-11'));
      assert.ok(rows.every(row=>groupBy.includes('appId')?row.appId==='ai_novel':row.appId===null));
      assert.ok(rows.every(row=>groupBy.includes('productKey')?row.productKey!==null:row.productKey===null));
      assert.ok(rows.every(row=>groupBy.includes('source')?row.source!==null:row.source===null));
    }
    const marketRows=await queryBillingRevenue(query,{...base,groupBy:['market']});
    assert.equal(marketRows.length,4);
    assert.deepEqual(new Set(marketRows.map(row=>row.market)),new Set(['app_store','google_play']));
    for(const market of ['xiaomi','vivo',null]) await pool.query(`INSERT INTO zook_ai_novel_billing_transactions(app_id,user_id,provider,provider_transaction_id,product_id,product_key,source,market,status,purchased_at,amount_minor,currency,is_sandbox,observed_at)
      VALUES('ai_novel','user','alipay',$1,'plus_monthly','plus_monthly','alipay',$2,'provider_paid','2026-10-10T00:00:00Z',3800,'CNY',true,now())`,['alipay_'+market,market]);
    const independent=await queryBillingRevenue(query,{...base,groupBy:['source','market']});
    assert.deepEqual(new Set(independent.filter(row=>row.source==='alipay').map(row=>row.market)),new Set(['xiaomi','vivo',null]));
    assert.deepEqual(await queryBillingRevenue(query,{...base,sandbox:false}),[]);
  }finally{await pool.end();await root.query(`DROP SCHEMA IF EXISTS ${schema} CASCADE`);await root.end();}
});
