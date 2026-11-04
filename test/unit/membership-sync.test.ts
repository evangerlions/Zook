import { seedAlipayPrices } from "../support/alipay-pricing-fixture.ts";
import assert from 'node:assert/strict';
import test from 'node:test';
import { createApplication } from '../support/create-test-application.ts';
import { buildDefaultSeed } from '../../src/infrastructure/database/prisma/default-seed.ts';
import { inBillingEnvironment } from '../../src/modules/billing/billing-environment.ts';
import { providerQuery } from '../../src/modules/billing/provider-query.ts';
import { confirmAlipayOrder } from '../../src/services/ainovel-alipay-confirmation.ts';
import { parseMembershipSync } from '../../src/modules/billing/membership-sync.ts';
import type { AlipayGateway } from '../../src/modules/billing/alipay-models.ts';

async function fixture() {
  let now = new Date('2026-10-01T10:00:00Z');
  const responses = new Map<string, Record<string, unknown> | (() => Promise<Record<string, unknown>>) >();
  const calls: string[] = [];
  const seed = buildDefaultSeed();
  seedAlipayPrices(seed);
  seed.appUsers!.push({id:'sync_alice',appId:'ai_novel',userId:'user_alice',status:'ACTIVE',accountRegion:'CN',joinedAt:now.toISOString()});
  const gateway: AlipayGateway = {payment:async()=>({type:'app',orderString:'signed'}),verifyNotify:async()=>true,
    query:async id=>{calls.push(id);const response=responses.get(id);return typeof response==='function'?response(): response??{code:'40004'};}};
  const runtime=await createApplication({seed,alipay:{sandbox:{appId:'merchant',sellerId:'seller',
    notifyUrl:'https://example.test/notify',returnUrl:'https://example.test/return',gateway,queryTimeoutMs:10,now:()=>now}},revenueCat:{now:()=>now}});
  const service=runtime.services.aiNovelBillingService;
  const create=async(productKey='plus_monthly')=>(await service.alipay.create('user_alice','CN',{
    productKey:productKey as any,platform:'android',distribution:'direct_android',idempotencyKey:'key_'+Math.random().toString(36).slice(2)})).order.orderId;
  const sync=(id?:string)=>service.syncMembership({userId:'user_alice',provider:'alipay',requestId:'test',purchaseReference:id?{kind:'alipay_order',id}:undefined});
  const paid=(id:string,amount='38.00',date='2026-10-01 18:00:00',trade='202610010000000001')=>responses.set(id,{
    code:'10000',out_trade_no:id,app_id:'merchant',seller_id:'seller',trade_no:trade,total_amount:amount,trade_status:'TRADE_SUCCESS',gmt_payment:date});
  return {...runtime,service,create,sync,paid,calls,responses,setNow:(value:string)=>{now=new Date(value);}};
}
const sandbox=(name:string,run:()=>Promise<void>)=>test(name,()=>inBillingEnvironment('sandbox',run));

sandbox('known orders never query again, concurrent synchronization grants once, GET is pure',async()=>{
  const f=await fixture(); const id=await f.create();f.paid(id);
  await Promise.all(Array.from({length:5},()=>f.sync(id)));
  const before=await f.service.getMembership('user_alice');const calls=f.calls.length;
  assert.equal(before.expiresAt,'2026-11-01T10:00:00.000Z');
  for(let i=0;i<3;i++)assert.equal((await f.sync(id)).targetPurchase?.entitlementStatus,'applied');
  await f.service.alipay.readOrder('user_alice',id);assert.equal(f.calls.length,calls);
  assert.equal((await f.database.listAiNovelBillingTransactions('ai_novel','user_alice')).length,1);
  f.setNow('2026-12-01T10:00:00Z');const expired=await f.sync(id);
  assert.equal(expired.membership.active,false);assert.equal(expired.targetPurchase?.entitlementStatus,'applied');assert.equal(f.calls.length,calls);
});
sandbox('timeout continues to later order and a successful target is independent from old pending',async()=>{
  const f=await fixture();const old=await f.create();const fresh=await f.create();
  f.responses.set(old,()=>new Promise(()=>{}));f.paid(fresh);
  const result=await f.sync(fresh);
  assert.equal(result.targetPurchase?.entitlementStatus,'applied');assert.equal(result.syncStatus,'pending');
  assert.equal(result.pendingOrderCount,1);assert.equal(result.membership.active,true);assert.deepEqual(f.calls,[fresh,old]);
});
sandbox('out of order month and quarter facts produce deterministic expiry, late WAIT cannot revoke',async()=>{
  const f=await fixture(); const month=await f.create();const quarter=await f.create('plus_quarterly');
  f.paid(quarter,'98.00','2026-10-01 18:00:00','202610010000000002');await f.sync(quarter);
  f.paid(month);await f.sync(month);
  assert.equal((await f.service.getMembership('user_alice')).expiresAt,'2027-02-01T10:00:00.000Z');
  const calls=f.calls.length;await f.sync();assert.equal(f.calls.length,calls);
});
sandbox('pure reads automatically fall back from expired Pro to valid Plus without sync',async()=>{
  const f=await fixture();const plus=await f.create('plus_yearly');f.paid(plus,'298.00');await f.sync(plus);
  const pro=await f.create('pro_monthly');f.paid(pro,'88.00','2026-10-01 18:00:00','202610010000000003');await f.sync(pro);
  assert.equal((await f.service.getMembership('user_alice')).tier,'pro');const calls=f.calls.length;
  f.setNow('2026-12-01T10:00:00Z');assert.equal((await f.service.getMembership('user_alice')).tier,'plus');assert.equal(f.calls.length,calls);
});
sandbox('foreign reference rejected and sandbox paid order never grants production access',async()=>{
  const f=await fixture();const id=await f.create();f.paid(id);await f.sync(id);
  await assert.rejects(()=>f.service.syncMembership({userId:'other',provider:'alipay',requestId:'foreign',purchaseReference:{kind:'alipay_order',id}}));
  await inBillingEnvironment('production',async()=>assert.equal((await f.service.getMembership('user_alice')).active,false));
});
test('one query deadline discards late results and external cancellation interrupts waiting',async()=>{
  await assert.rejects(()=>providerQuery(()=>new Promise(resolve=>setTimeout(()=>resolve('late'),30)),undefined,5));
  const controller=new AbortController();const result=providerQuery(()=>new Promise(()=>{}),controller.signal,1000);controller.abort();await assert.rejects(()=>result);
  assert.throws(()=>parseMembershipSync({provider:'alipay',purchaseReference:{kind:'store_transaction',id:'foreign'}}));
});
sandbox('a later independent paid query wins even when earlier WAIT response arrives last',async()=>{
 const f=await fixture();const id=await f.create();let release:(v:Record<string,unknown>)=>void=()=>{};let entered:()=>void=()=>{};
 const started=new Promise<void>(resolve=>{entered=resolve;});
 f.responses.set(id,()=>{entered();return new Promise(resolve=>{release=resolve;});});
 const a=f.sync(id);await started;f.paid(id);const b=await f.sync(id);assert.equal(b.targetPurchase?.status,'paid');
 release({code:'10000',out_trade_no:id,trade_no:'202610010000000001',total_amount:'38.00',trade_status:'WAIT_BUYER_PAY'});
 await a;assert.equal((await f.service.alipay.readOrder('user_alice',id)).order.status,'paid');
});
sandbox('paid but unapplied recovery uses local evidence and preserves verified historical merchant access',async()=>{
 const f=await fixture();const id=await f.create();f.paid(id);await f.sync(id);const order=(await f.database.findAiNovelAlipayOrder(id))!;
 await f.database.saveAiNovelAlipayOrder({...order,membershipApplied:false});const calls=f.calls.length;
 await f.sync(id);assert.equal(f.calls.length,calls);assert.equal((await f.database.findAiNovelAlipayOrder(id))!.membershipApplied,true);
 await f.database.saveAiNovelAlipayOrder({...order,merchantAppId:'previous-merchant'});
 const second=await f.create('plus_quarterly');f.paid(second,'98.00','2026-10-01 18:00:00','202610010000000004');await f.sync(second);
 assert.equal((await f.service.getMembership('user_alice')).expiresAt,'2027-02-01T10:00:00.000Z');
});
sandbox('background attempts rotate failed candidates so order 21 is not starved',async()=>{
 const f=await fixture();const ids=[];for(let i=0;i<21;i++)ids.push(await f.create());
 f.setNow('2026-10-01T10:01:00Z');await f.service.alipay.recoverOrders(20);assert.equal(f.calls.length,20);
 const omitted=ids.find(id=>!f.calls.includes(id))!;assert.ok(omitted);
 f.setNow('2026-10-01T10:02:00Z');await f.service.alipay.recoverOrders(20);assert.ok(f.calls.includes(omitted));
});

sandbox('trusted refund survives duplicate paid notification and unapplied recovery',async()=>{
 const f=await fixture();const id=await f.create();f.paid(id);await f.sync(id);
 const transaction=(await f.database.listAiNovelBillingTransactions('ai_novel','user_alice'))[0];
 const refund={...transaction,status:'refunded',refundedAt:'2026-10-01T10:01:00.000Z',refundAmountMinor:3800,observedAt:'2026-10-01T10:01:00.000Z'};
 await f.database.upsertAiNovelBillingTransaction(refund);
 await confirmAlipayOrder(f.database,{appId:'merchant',sellerId:'seller',environment:'sandbox'} as any,
  f.responses.get(id) as Record<string,unknown>,'notify',new Date('2026-10-01T10:02:00Z'));
 assert.equal((await f.service.getMembership('user_alice')).active,false);
 const calls=f.calls.length;await f.sync(id);assert.equal(f.calls.length,calls);
 assert.equal((await f.database.findAiNovelAlipayOrder(id))!.membershipApplied,false);
 assert.deepEqual((await f.database.listAiNovelBillingTransactions('ai_novel','user_alice'))[0],refund);
});

for (const status of ['refunded','revoked']) sandbox(`recorded ${status} fact converges locally without another payment notification`,async()=>{
 const f=await fixture();const id=await f.create();f.paid(id);await f.sync(id);
 const transaction=(await f.database.listAiNovelBillingTransactions('ai_novel','user_alice'))[0];
 const refund={...transaction,status,refundedAt:'2026-10-01T10:01:00.000Z',refundAmountMinor:3800,observedAt:'2026-10-01T10:01:00.000Z'};
 await f.database.upsertAiNovelBillingTransaction(refund);const calls=f.calls.length;
 // No target/local marker is required to discover the changed financial fact.
 assert.equal((await f.sync()).membership.active,false);
 const result=await f.sync(id);assert.equal(result.membership.active,false);
 assert.equal(result.targetPurchase?.entitlementStatus,'blocked');assert.equal(result.pendingOrderCount,0);
 assert.equal(result.syncStatus,'complete');assert.equal(f.calls.length,calls);
 const order=(await f.database.findAiNovelAlipayOrder(id))!;
 assert.equal(order.membershipApplied,false);assert.equal(order.membershipStartsAt,null);assert.equal(order.membershipExpiresAt,null);
 assert.deepEqual((await f.database.listAiNovelBillingTransactions('ai_novel','user_alice'))[0],refund);
});
