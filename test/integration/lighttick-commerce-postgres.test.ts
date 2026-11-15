import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {PostgresLightTickRepository} from '../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts';
import {runPostgresMigrations} from '../../src/infrastructure/database/postgres/migrate.ts';
import {LightTickCommerceService} from '../../src/modules/lighttick/billing/commerce.service.ts';
import {billingPolicy} from '../../src/modules/lighttick/billing/commerce-policy.ts';
const dsn=process.env.LIGHTTICK_TEST_DATABASE_URL;if(!dsn||new URL(dsn).hostname!=='127.0.0.1'||!new URL(dsn).pathname.startsWith('/grow_web_u1_'))throw Error('Disposable local DB required');
test('PostgreSQL atomic quota, checkout recovery, environment isolation, refund and owner deletion',async()=>{
 await runPostgresMigrations({connectionString:dsn,log:()=>{}});const pool=new Pool({connectionString:dsn});const repo=new PostgresLightTickRepository(pool);const owner={appId:'lighttick' as const,userId:'commerce-pg-'+randomUUID()};
 const raw={billing:{limits:{basic:6,premium:100,professional:1000},prices:{premium:2900,professional:9900}}};repo.configureStorageQuota(async()=>billingPolicy(raw));let evidence:any={};
 const gateway={checkout:async()=>({type:'page' as const,url:'https://openapi.alipay.com/gateway.do?synthetic=true'}),query:async()=>evidence,verifyNotify:async()=>true};
 const service=new LightTickCommerceService(repo,async()=>raw,{production:{appId:'merchant',gateway},sandbox:{appId:'sandbox',gateway}},async()=>true);
 const pub={...owner,lessonId:'quota',contentVersion:'1'.repeat(64),content:'中文',references:'',sourceUrl:'',createdAt:new Date().toISOString()};
 try {
  // Publication FK requires real native collection and lesson identities.
  await repo.saveLearningCollection({...owner,id:'quota-course',title:'Quota',description:'',revision:1,archived:false,createdAt:pub.createdAt,updatedAt:pub.createdAt} as any,0);
  await repo.saveNativeLesson({...owner,id:'quota',collectionId:'quota-course',number:1,title:'Quota',summary:'',revision:1,publishedVersion:null,archived:false,createdAt:pub.createdAt,updatedAt:pub.createdAt} as any,0);
  const concurrent=await Promise.allSettled(['a'.repeat(64),'b'.repeat(64)].map(contentVersion=>repo.insertLessonPublication({...pub,contentVersion,content:'abcd'})));
  assert.equal(concurrent.filter(r=>r.status==='fulfilled').length,1);assert.equal((await repo.getStorageUsage(owner)).totalUsed,4);
  await pool.query('DELETE FROM zook_lighttick_lesson_publications WHERE app_id=$1 AND user_id=$2',[owner.appId,owner.userId]);
  await repo.insertLessonPublication(pub);await repo.insertLessonPublication(pub);
  const failures=await Promise.allSettled(['2'.repeat(64),'3'.repeat(64)].map(contentVersion=>repo.transaction(owner,()=>repo.insertLessonPublication({...pub,contentVersion,content:'x'}))));assert.equal(failures.filter(r=>r.status==='rejected').length,2);
  const made=await service.create(owner,'production','pg-checkout-request-001','premium',2900);
  const reopened=new PostgresLightTickRepository(pool);assert.equal((await reopened.getPaymentOrder(owner,'production','pg-checkout-request-001'))?.id,made.order.id);
  assert.equal(await reopened.getPaymentOrder({...owner,userId:'other'},'production',made.order.id),undefined);
  const stored=await service.read(owner,'production',made.order.id);const local=new Date(Date.now()+8*3600000).toISOString().slice(0,19).replace('T',' ');
  evidence={code:'10000',out_trade_no:stored.merchantOrderId,total_amount:'29.00',trade_no:'pg-trade-'+stored.id,trade_status:'TRADE_SUCCESS',send_pay_date:local};
  const results=await Promise.all([service.sync(owner,'production',stored.id),service.sync(owner,'production',stored.id)]);assert.equal(results[0].endsAt,results[1].endsAt);assert.equal((await repo.getStorageUsage(owner)).totalLimit,100);
  await repo.insertLessonPublication({...pub,contentVersion:'2'.repeat(64),content:'x'});assert.equal((await repo.getStorageUsage(owner)).totalUsed,7);
  evidence={...evidence,trade_status:'TRADE_CLOSED',refund_fee:'29.00',gmt_refund:local};await service.sync(owner,'production',stored.id);assert.equal((await repo.getStorageUsage(owner)).totalLimit,6);
  await assert.rejects(()=>repo.insertLessonPublication({...pub,contentVersion:'3'.repeat(64),content:'x'}),{statusCode:402});await repo.insertLessonPublication(pub);
  await repo.deleteOwnerData(owner);const retained=await reopened.getPaymentOrder(owner,'production',stored.id);assert.equal(retained?.status,'refunded');assert.ok(retained?.accountDeletedAt);assert.equal(await reopened.getUserSubscription(owner),undefined);
 }finally {await repo.deleteOwnerData(owner);await pool.query('DELETE FROM zook_lighttick_payment_orders WHERE user_id=$1',[owner.userId]);await pool.end();}
});
