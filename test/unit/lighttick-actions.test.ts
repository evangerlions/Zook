import test from 'node:test';import assert from 'node:assert/strict';
import {InMemoryLightTickRepository} from '../../src/testing/in-memory-lighttick-repository.ts';
import {ActionService} from '../../src/modules/lighttick/actions/action.service.ts';
const owner={appId:'lighttick',userId:'action-owner'} as const;
const setup=()=>new ActionService(new InMemoryLightTickRepository(),()=>new Date('2026-10-19T12:00:00Z'));
let serial=0;
const create=async(s:ActionService,updates={})=>(await s.request(owner,'POST','',{title:'先阅读再刷视频',period:'day',start_date:'2026-10-19',end_date:'2026-10-19',key:'create-key-'+(++serial),...updates}) as any).plans[0];
const mutate=async(s:ActionService,p:any,action:string,updates={})=>s.request(owner,'POST',`/${p.id}/operations`,{revision:p.revision,action,key:'operation-key-'+(++serial),...updates}) as Promise<any>;
test('four periods share actual facts; minimum and interruption do not invent completion',async()=>{
 const s=setup(),year=await create(s,{period:'year',start_date:'2026-01-01',end_date:'2026-12-31'}),month=await create(s,{period:'month',start_date:'2026-10-01',end_date:'2026-10-31',parent_id:year.id}),week=await create(s,{period:'week',start_date:'2026-10-19',end_date:'2026-10-25',parent_id:month.id});let p=await create(s,{parent_id:week.id});
 for(const [variant,actual_minutes,outcome] of [['minimum',5,'completed'],['standard',2,'interrupted'],['standard',20,'completed']] as const){const start=await mutate(s,p,'start',{variant});const finish=await mutate(s,start.plan,'finish',{execution_id:start.execution.id,actual_minutes,outcome});p=finish.plan;}
 const result=await s.request(owner,'GET','') as any;assert.equal(result.execution,null);for(const plan of result.plans)assert.deepEqual(plan.progress,{minutes:27,completed:1,minimum:1,partial:0,interrupted:1});assert.equal(result.plans.find((p:any)=>p.id===year.id).horizon,'long');
 const scope={plan_id:month.id,start_date:month.start_date,end_date:month.end_date};const preview=await s.request(owner,'POST','/reviews/preview',scope) as any;assert.equal(preview.stats.minutes,27);
 const saved=await s.request(owner,'POST','/reviews',{...scope,key:'review-key-1',worked:'五分钟起步',next_action:'把手机放远'});const history=await s.request(owner,'GET','/reviews',{}, {plan_id:month.id}) as any;assert.equal(history.reviews.length,1);assert.equal(history.reviews[0].stats.completed,1);
});
test('tenant isolation, concurrent start, stale revisions and idempotent retries',async()=>{
 const s=setup(),a=await create(s),b=await create(s);const results=await Promise.allSettled([mutate(s,a,'start'),mutate(s,b,'start')]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 await assert.rejects(s.request({...owner,userId:'other'},'POST',`/${a.id}/operations`,{key:'foreign-key',revision:1,action:'pause'}),/不存在/);
 const body={title:'same',period:'day',start_date:'2026-10-19',end_date:'2026-10-19',key:'repeated-create-key'};const first=await s.request(owner,'POST','',body);assert.deepEqual(await s.request(owner,'POST','',body),first);await assert.rejects(s.request(owner,'POST','',{...body,title:'different'}),/不同内容/);
 const pending=(await s.request(owner,'GET','') as any).execution;await assert.rejects(mutate(s,a.id===pending.plan_id?a:b,'finish',{execution_id:pending.id,actual_minutes:20}),(e:any)=>e.code==='REVISION_CONFLICT');
});
test('parent pause, date boundaries, reminder and calendar semantics',async()=>{
 const s=setup(),month=await create(s,{period:'month',start_date:'2026-10-01',end_date:'2026-10-31'}),p=await create(s,{parent_id:month.id,at:'19:00',reminder:true});
 const claim={key:'notification-claim',device_id:'device-123',reminder_at:p.reminder_at};assert.equal((await s.request(owner,'POST',`/${p.id}/reminder-claim`,claim) as any).notify,true);
 assert.match(await s.request(owner,'GET',`/${p.id}/calendar.ics`) as string,/DTSTART:20261019T110000Z/);await mutate(s,month,'pause');await assert.rejects(mutate(s,p,'start'),(e:any)=>e.code==='STATE_CONFLICT');
 await assert.rejects(create(s,{period:'month',start_date:'2026-10-01',end_date:'2026-11-01'}),(e:any)=>e.code==='VALIDATION_ERROR');
});
