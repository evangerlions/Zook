import {test} from 'node:test';
import assert from 'node:assert/strict';
import {InMemoryLightTickRepository} from '../../src/testing/in-memory-lighttick-repository.ts';
import {LightTickCommerceService} from '../../src/modules/lighttick/billing/commerce.service.ts';
import {billingPolicy,LIGHTTICK_BILLING_DEFAULTS,validateLightTickBilling,subscriptionFromOrders,storageLimit} from '../../src/modules/lighttick/billing/commerce-policy.ts';
const owner={appId:'lighttick' as const,userId:'buyer'};
function fixture(){
 const repo=new InMemoryLightTickRepository();let raw:any={billing:structuredClone(LIGHTTICK_BILLING_DEFAULTS)};let evidence:any={};let active=true;
 const now=new Date(Math.floor(Date.now()/1000)*1000);
 const gateway={checkout:async()=>({type:'page' as const,url:'https://openapi.alipay.com/gateway.do?synthetic=true'}),query:async()=>evidence,verifyNotify:async(v:any)=>v.sign==='valid'};
 const options={production:{appId:'merchant',gateway},sandbox:{appId:'sandbox-merchant',gateway}};
 const service=new LightTickCommerceService(repo,async()=>raw,options,async()=>active,()=>now);
 repo.configureStorageQuota(async()=>billingPolicy(raw));
 return {repo,service,now,setConfig:(v:any)=>raw=v,setActive:(v:boolean)=>active=v,setEvidence:(order:any,extra:any={})=>evidence={code:'10000',app_id:order.merchantAppId,out_trade_no:order.merchantOrderId,total_amount:(order.amountMinor/100).toFixed(2),trade_no:'trade-'+order.id,trade_status:'TRADE_SUCCESS',send_pay_date:new Date(+now+8*3600000).toISOString().slice(0,19).replace('T',' '),...extra}};
}
test('prices are versioned minor units; missing prices stop new sales',()=>{assert.deepEqual(billingPolicy({}).prices,{});assert.throws(()=>validateLightTickBilling('lighttick',JSON.stringify({billing:{prices:{premium:0}}})));assert.equal(billingPolicy({billing:LIGHTTICK_BILLING_DEFAULTS}).prices.premium,2900);});
test('durable checkout replay freezes price, account and merchant; only verified sync grants once',async()=>{
 const f=fixture();const a=await f.service.create(owner,'production','purchase-request-0001','premium');assert.equal(a.order.amountMinor,2900);
 f.setConfig({billing:{limits:LIGHTTICK_BILLING_DEFAULTS.limits}});
 const again=await f.service.create(owner,'production','purchase-request-0001','premium');assert.equal(a.order.id,again.order.id);
 await assert.rejects(()=>f.service.create(owner,'production','purchase-request-0002','premium'));
 await assert.rejects(()=>f.service.create(owner,'production','purchase-request-0001','professional'));
 assert.equal(await f.repo.getUserSubscription(owner),undefined);
 const stored=await f.service.read(owner,'production',a.order.id);f.setEvidence(stored,{total_amount:'0.01'});
 await assert.rejects(()=>f.service.sync(owner,'production',a.order.id));assert.equal(await f.repo.getUserSubscription(owner),undefined);
 f.setEvidence(stored,{app_id:'wrong-merchant'});await assert.rejects(()=>f.service.sync(owner,'production',a.order.id));
 f.setEvidence(stored,{send_pay_date:'2099-01-01 00:00:00'});await assert.rejects(()=>f.service.sync(owner,'production',a.order.id));
 f.setEvidence(stored);const paid=await f.service.sync(owner,'production',a.order.id);const replay=await f.service.sync(owner,'production',a.order.id);
 assert.equal(paid.endsAt,replay.endsAt);assert.ok(Date.parse(paid.endsAt!)>+f.now+27*86400000);assert.equal((await f.repo.getUserSubscription(owner))?.planId,'premium');
 await assert.rejects(()=>f.service.read({...owner,userId:'other'},'production',a.order.id));await assert.rejects(()=>f.service.read(owner,'sandbox',a.order.id));
});
test('refund is monotonic and deleted accounts cannot receive entitlements',async()=>{
 const f=fixture();const a=await f.service.create(owner,'production','refund-request-0001','premium');const stored=await f.service.read(owner,'production',a.order.id);
 f.setEvidence(stored);await f.service.sync(owner,'production',a.order.id);
 f.setEvidence(stored,{trade_status:'TRADE_CLOSED',refund_fee:'29.00',gmt_refund:new Date(+f.now+8*3600000).toISOString().slice(0,19).replace('T',' ')});
 assert.equal((await f.service.sync(owner,'production',a.order.id)).status,'refunded');assert.equal(await f.repo.getUserSubscription(owner),undefined);
 f.setEvidence(stored);assert.equal((await f.service.sync(owner,'production',a.order.id)).status,'refunded');
 const b=await f.service.create(owner,'sandbox','deleted-request-0001','professional');const bs=await f.service.read(owner,'sandbox',b.order.id);f.setActive(false);f.setEvidence(bs);
 assert.equal((await f.service.sync(owner,'sandbox',b.order.id)).startsAt,null);assert.equal(await f.repo.getUserSubscription(owner,'sandbox'),undefined);
});
test('quota counts UTF8 bytes, prevents concurrent growth, and permits immutable replay',async()=>{
 const f=fixture();f.setConfig({billing:{limits:{basic:6,premium:100,professional:200}}});
 const pub={...owner,lessonId:'lesson',contentVersion:'v1',content:'中文',references:'',sourceUrl:'',createdAt:new Date().toISOString()};
 await f.repo.transaction(owner,()=>f.repo.insertLessonPublication(pub));assert.equal((await f.repo.getStorageUsage(owner)).totalUsed,6);
 await f.repo.transaction(owner,()=>f.repo.insertLessonPublication(pub));
 await assert.rejects(()=>f.repo.transaction(owner,()=>f.repo.insertLessonPublication({...pub,contentVersion:'v2',content:'x'})),{statusCode:402,code:'LIGHTTICK_STORAGE_QUOTA_EXCEEDED'});
 const other={...owner,userId:'concurrent'};const results=await Promise.allSettled(['1','2'].map(contentVersion=>f.repo.transaction(other,()=>f.repo.insertLessonPublication({...pub,...other,contentVersion,content:'abcd'}))));assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
});
test('sandbox verified purchase never changes production storage quota',async()=>{
 const f=fixture();const a=await f.service.create(owner,'sandbox','sandbox-request-0001','professional');f.setEvidence(await f.service.read(owner,'sandbox',a.order.id));await f.service.sync(owner,'sandbox',a.order.id);
 assert.equal((await f.repo.getUserSubscription(owner,'sandbox'))?.planId,'professional');assert.equal((await f.repo.getStorageUsage(owner)).totalLimit,500*1024**2);
});

test('same-tier renewal queues one month; highest active tier falls back without provider IO',async()=>{
 const f=fixture();
 async function buy(plan:'premium'|'professional',key:string){const created=await f.service.create(owner,'production',key,plan);f.setEvidence(await f.service.read(owner,'production',created.order.id));return f.service.sync(owner,'production',created.order.id);}
 const first=await buy('premium','renewal-purchase-first');const second=await buy('premium','renewal-purchase-next');assert.equal(second.startsAt,first.endsAt);
 const pro=await buy('professional','upgrade-purchase-pro');const orders=await f.repo.listPaymentOrders(owner,'production');assert.equal(subscriptionFromOrders(orders,f.now)?.planId,'professional');
 const later=new Date(Date.parse(pro.endsAt!)+1);const fallback=subscriptionFromOrders(orders,later);assert.equal(fallback?.planId,'premium');assert.equal(storageLimit(billingPolicy({billing:LIGHTTICK_BILLING_DEFAULTS}),fallback,later),5*1024**3);
 assert.equal(subscriptionFromOrders(orders,new Date(Date.parse(second.endsAt!)+1)),undefined);
});
