import test from 'node:test';
import assert from 'node:assert/strict';
import {ActionService} from '../../src/modules/lighttick/actions/action.service.ts';
import {InMemoryLightTickRepository} from '../../src/testing/in-memory-lighttick-repository.ts';

const owner={appId:'lighttick',userId:'p0-owner'} as const;
let serial=0;
function setup(){let time=new Date('2026-10-19T12:00:00Z');const repo=new InMemoryLightTickRepository();
 return {repo,service:new ActionService(repo,()=>time),advance:(date:string)=>{time=new Date(date);}};}
const create=async(s:ActionService,values:Record<string,unknown>={})=>(await s.request(owner,'POST','',{
 title:'P0 action',period:'day',completion_mode:'check',start_date:'2026-10-19',end_date:'2026-10-19',key:'p0-create-'+ ++serial,...values}) as any).plans[0];
const op=(s:ActionService,p:any,action:string,values={})=>s.request(owner,'POST',`/${p.id}/operations`,{
 key:'p0-operation-'+ ++serial,revision:p.revision,action,...values}) as Promise<any>;
const rejects=(promise:Promise<unknown>,status:number,code:string)=>assert.rejects(promise,(e:any)=>e.statusCode===status&&e.code===code);
const source={kind:'article',course:'article-p0-source'};
async function seedSource(repo:InMemoryLightTickRepository){
 const row=await repo.getActionWorkspace(owner)??{...owner,data:{plans:[],records:[],reviews:[],reports:[],claims:{}},version:0};
 (row.data as any).content_sources=[source];await repo.saveActionWorkspace(row);
}
async function seedEvent(repo:InMemoryLightTickRepository,p:any,updates={}){
 const row=(await repo.getActionWorkspace(owner))!;
 const event={event_id:'source-event-'+ ++serial,owner_id:owner.userId,normalized_target:source,confirmed_at:'2026-10-19T12:00:00Z',
  origin_action_id:p.id,planned_date_at_confirmation:p.start_date,timezone_at_confirmation:p.timezone,...updates};
 ((row.data as any).content_events??=[]).push(event);await repo.saveActionWorkspace(row);return event;
}
test('v2 nullable check fields and validation are atomic, with no fabricated time',async()=>{
 const {service:s}=setup(),p=await create(s,{start_date:null,end_date:null});
 for(const key of ['start_date','end_date','at','reminder_at','target','target_minutes','minimum_minutes'])assert.equal(p[key],null,key);
 assert.equal(p.schema_version,2);await rejects(op(s,p,'complete'),422,'UNSCHEDULED_ACTION');
 for(const values of [{title:' '},{target_minutes:0,completion_mode:'time'},{target_minutes:2.5,completion_mode:'time'},
  {start_date:null},{timezone:'bad/zone'},{reminder:true},{completion_mode:'content'}])await rejects(create(s,values),422,'VALIDATION_ERROR');
 assert.equal((await s.request(owner,'GET','') as any).plans.length,1);
});
test('time accumulates confirmed sessions, actual and planned dates stay distinct',async()=>{
 const {service:s}=setup();let p=await create(s,{completion_mode:'time',start_date:'2026-10-18',end_date:'2026-10-18'});
 for(const minutes of [5,15]){const start=await op(s,p,'start');p=(await op(s,start.plan,'finish',{execution_id:start.execution.id,actual_minutes:minutes})).plan;}
 assert.equal(p.status,'completed');const result=await s.request(owner,'GET','') as any;
 assert.deepEqual(result.plans[0].progress,{minutes:20,completed:1,minimum:1,partial:0,interrupted:0});
 const records=await s.request(owner,'GET','/records') as any;
 assert.equal(records.total,2);assert.ok(records.records.every((r:any)=>r.business_date==='2026-10-19'&&r.planned_date==='2026-10-18'));
 await rejects(op(s,p,'start'),409,'STATE_CONFLICT');
 const preview=await s.request(owner,'POST','/reviews/preview',{plan_id:p.id,start_date:'2026-10-19',end_date:'2026-10-19'}) as any;
 assert.equal(preview.stats.completed,1);assert.equal(preview.stats.minutes,20);
});
test('interrupted threshold requires a zero-minute explicit completion, replayed atomically',async()=>{
 const {service:s}=setup();let p=await create(s,{completion_mode:'time'});const start=await op(s,p,'start');
 p=(await op(s,start.plan,'finish',{execution_id:start.execution.id,actual_minutes:20,outcome:'interrupted'})).plan;
 assert.equal(p.status,'active');const body={key:'p0-explicit-completion',revision:p.revision,action:'complete-time'};
 const result=await s.request(owner,'POST',`/${p.id}/operations`,body) as any;
 assert.equal(result.execution.record_kind,'completion');assert.equal(result.execution.actual_minutes,0);
 assert.deepEqual(await s.request(owner,'POST',`/${p.id}/operations`,body),result);
 assert.equal((await s.request(owner,'GET','/records') as any).total,2);
});
test('check completion reversal preserves audit and counts the effective action once',async()=>{
 const {service:s}=setup();let p=await create(s);p=(await op(s,p,'complete')).plan;p=(await op(s,p,'reopen')).plan;
 assert.equal((await s.request(owner,'GET','') as any).plans[0].progress.completed,0);p=(await op(s,p,'complete')).plan;
 const rows=(await s.request(owner,'GET','/records') as any).records;
 assert.equal(rows.length,3);const reversal=rows.find((r:any)=>r.record_kind==='reversal');assert.ok(reversal.reverses_record_id);
 assert.deepEqual((await s.request(owner,'GET','') as any).plans[0].progress,{minutes:0,completed:1,minimum:0,partial:0,interrupted:0});
});
test('running, stale versions, ancestor blocks and immutable fact configuration',async()=>{
 const {service:s}=setup(),parent=await create(s,{period:'week',completion_mode:'time',end_date:'2026-10-25'});
 let p=await create(s,{parent_id:parent.id,completion_mode:'time'});const start=await op(s,p,'start');
 await rejects(op(s,p,'pause'),409,'REVISION_CONFLICT');await rejects(op(s,parent,'pause'),409,'RUNNING_CONFLICT');
 await rejects(op(s,start.plan,'reschedule',{date:null}),409,'RUNNING_CONFLICT');
 p=(await op(s,start.plan,'finish',{execution_id:start.execution.id,actual_minutes:3})).plan;
 await rejects(op(s,p,'edit',{fields:{...p,target_minutes:30}}),422,'VALIDATION_ERROR');
 const fields=Object.fromEntries(['title','period','horizon','start_date','end_date','timezone','parent_id','target_minutes','minimum_minutes','target_count','at','reminder','reason','if_then','target','completion_mode','estimated_minutes'].map(k=>[k,p[k]]));
 await rejects(op(s,p,'edit',{fields:{...fields,target_minutes:30}}),409,'STATE_CONFLICT');
 const paused=(await op(s,parent,'pause')).plan;await rejects(op(s,p,'start'),409,'STATE_CONFLICT');
 await op(s,paused,'resume');assert.ok((await op(s,p,'start')).execution);
});
test('content requires owner-scoped durable evidence and preserves a running timer',async()=>{
 const {repo,service:s,advance}=setup();await seedSource(repo);let p=await create(s,{completion_mode:'content',target:source});
 await rejects(op(s,p,'complete'),422,'VALIDATION_ERROR');await rejects(op(s,p,'reconcile-content'),409,'COMPLETION_EVIDENCE_MISSING');
 const start=await op(s,p,'start'),event=await seedEvent(repo,p);await rejects(op(s,start.plan,'reconcile-content',{source_event_id:event.event_id}),409,'RUNNING_CONFLICT');
 p=(await op(s,start.plan,'finish',{execution_id:start.execution.id,actual_minutes:8})).plan;
 assert.equal(p.status,'active');advance('2026-10-20T12:00:00Z');const done=await op(s,p,'reconcile-content',{source_event_id:event.event_id});
 assert.equal(done.execution.business_date,'2026-10-19');assert.equal(done.execution.actual_minutes,0);
 assert.equal((await s.request(owner,'GET','') as any).plans[0].progress.minutes,8);
 assert.equal((await s.request(owner,'GET','/records') as any).total,2);
});
test('schedule deduplication, null bucket and conflicting reschedule do not overwrite',async()=>{
 const {repo,service:s}=setup();await seedSource(repo);
 const arrange=(date:string|null,key:string)=>s.request(owner,'POST','/schedules',{key,title:'source',target:source,date}) as Promise<any>;
 const a=await arrange('2026-10-19','p0-schedule-a'),same=await arrange('2026-10-19','p0-schedule-b');assert.equal(same.plan.id,a.plan.id);assert.equal(same.existing,true);
 const undated=await arrange(null,'p0-schedule-null');await rejects(op(s,undated.plan,'reschedule',{date:'2026-10-19'}),409,'DUPLICATE_SCHEDULE');
 assert.equal((await s.request(owner,'GET','') as any).plans.find((p:any)=>p.id===undated.plan.id).revision,1);
 const cancelled=(await op(s,a.plan,'cancel')).plan;assert.equal(cancelled.status,'archived');
 assert.notEqual((await arrange('2026-10-19','p0-schedule-new')).plan.id,a.plan.id);
});
test('calendar and claims never fabricate a time or use a completion threshold for content',async()=>{
 const {service:s}=setup(),p=await create(s);await rejects(s.request(owner,'GET',`/${p.id}/calendar.ics`),422,'VALIDATION_ERROR');
 const timed=await create(s,{at:'19:00',reminder:false});const ics=await s.request(owner,'GET',`/${timed.id}/calendar.ics`) as string;
 assert.match(ics,/DTSTART:20261019T110000Z/);assert.doesNotMatch(ics,/VALARM/);
});

for(const target of [source,{kind:'plan',plan_id:'plan-p0-course',lesson_no:1}]){
 test(`${target.kind} evidence is private, date scoped, one-use and cannot bypass rescheduling`,async()=>{
  const {repo,service:s}=setup();await seedSource(repo);
  const row=(await repo.getActionWorkspace(owner))!;row.data.content_sources=[target];await repo.saveActionWorkspace(row);
  let today=await create(s,{completion_mode:'content',target});
  const past=await create(s,{completion_mode:'content',target,start_date:'2026-10-18',end_date:'2026-10-18'});
  const future=await create(s,{completion_mode:'content',target,start_date:'2026-10-20',end_date:'2026-10-20'});
  const undated=await create(s,{completion_mode:'content',target,start_date:null,end_date:null});
  await rejects(op(s,today,'reconcile-content'),409,'COMPLETION_EVIDENCE_MISSING');
  const event=await seedEvent(repo,today,{normalized_target:target,origin_action_id:null});
  await rejects(op(s,past,'reconcile-content',{source_event_id:event.event_id}),409,'COMPLETION_EVIDENCE_MISSING');
  await rejects(op(s,future,'reconcile-content',{source_event_id:event.event_id}),422,'FUTURE_ACTION');
  await rejects(op(s,undated,'reconcile-content',{source_event_id:event.event_id}),422,'UNSCHEDULED_ACTION');
  today=(await op(s,today,'reconcile-content',{source_event_id:event.event_id})).plan;
  assert.equal(today.status,'completed');
  await rejects(s.request({...owner,userId:'other-owner'},'POST',`/${today.id}/operations`,{key:'foreign-p0-key',revision:today.revision,action:'reconcile-content',source_event_id:event.event_id}),404,'LIGHTTICK_RESOURCE_NOT_FOUND');
  const back=await seedEvent(repo,past,{normalized_target:target,confirmed_at:'2026-10-18T12:00:00Z'});
  await rejects(op(s,past,'reconcile-content',{source_event_id:back.event_id}),409,'COMPLETION_EVIDENCE_MISSING');
  const wrong=await seedEvent(repo,past,{normalized_target:target,owner_id:'different-owner'});
  await rejects(op(s,past,'reconcile-content',{source_event_id:wrong.event_id}),404,'LIGHTTICK_RESOURCE_NOT_FOUND');
 });
}

test('cross-midnight sessions, zero interruption, confirmation date and legacy read preservation',async()=>{
 const {repo,service:s,advance}=setup();let p=await create(s,{completion_mode:'time',target_minutes:20,minimum_minutes:null});
 advance('2026-10-19T15:58:00Z');const start=await op(s,p,'start');advance('2026-10-19T16:10:00Z');
 await rejects(op(s,start.plan,'finish',{execution_id:start.execution.id,actual_minutes:0}),422,'VALIDATION_ERROR');
 const done=await op(s,start.plan,'finish',{execution_id:start.execution.id,actual_minutes:12});assert.equal(done.execution.business_date,'2026-10-19');assert.equal(done.execution.outcome,'partial');
 const old=(await repo.getActionWorkspace(owner))!;old.data.records[0]={...old.data.records[0],business_date:'2026-10-17'};
 for(const key of ['schema_version','record_kind','completion_mode','completion_effect','planned_date','date_basis'])delete (old.data.records[0] as any)[key];
 await repo.saveActionWorkspace(old);const stored=JSON.stringify(await repo.getActionWorkspace(owner));
 const records=await s.request(owner,'GET','/records') as any;assert.equal(records.records[0].business_date,'2026-10-17');assert.equal(records.records[0].date_basis,'legacy_planned');
 assert.equal(JSON.stringify(await repo.getActionWorkspace(owner)),stored,'read adapter must not rewrite storage');
 const immutableLegacy=JSON.stringify((await repo.getActionWorkspace(owner))!.data.records[0]);
 await create(s,{title:'Unrelated new action'});
 assert.equal(JSON.stringify((await repo.getActionWorkspace(owner))!.data.records[0]),immutableLegacy,'unrelated writes must not persist read-adapter fields into immutable legacy facts');
 const running=await op(s,done.plan,'start');const interrupted=await op(s,running.plan,'finish',{execution_id:running.execution.id,actual_minutes:0,outcome:'interrupted'});
 assert.equal(interrupted.execution.actual_minutes,0);assert.equal(interrupted.plan.status,'active');
});

test('concurrent check completion and dedup keep one effect with transactional receipts',async()=>{
 const {repo,service:s}=setup(),p=await create(s);
 const results=await Promise.allSettled([op(s,p,'complete'),op(s,p,'complete')]);assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 const winner=(results.find(r=>r.status==='fulfilled') as PromiseFulfilledResult<any>).value;
 assert.equal((await s.request(owner,'GET','/records') as any).total,1);
 await rejects(op(s,p,'complete'),409,'REVISION_CONFLICT');assert.equal(winner.plan.status,'completed');
 await seedSource(repo);
 const arrange=(key:string)=>s.request(owner,'POST','/schedules',{key,title:'one source',target:source,date:null}) as Promise<any>;
 const same=await Promise.all([arrange('p0-concurrent-source-a'),arrange('p0-concurrent-source-b')]);assert.equal(same[0].plan.id,same[1].plan.id);
 const before=JSON.stringify(await repo.getActionWorkspace(owner));
 await rejects(op(s,same[0].plan,'reschedule',{date:'invalid'}),422,'VALIDATION_ERROR');assert.equal(JSON.stringify(await repo.getActionWorkspace(owner)),before);
});

test('read-only receipt lookup and review preview never persist report recovery',async()=>{
 const {repo,service:s}=setup(),p=await create(s),row=(await repo.getActionWorkspace(owner))!;
 row.data.reports.push({id:'report-old-worker',state:'generating',created_at:'2026-10-19T11:00:00Z'});
 await repo.saveActionWorkspace(row);const before=JSON.stringify(await repo.getActionWorkspace(owner));
 await s.request(owner,'GET','/requests/unknown-key');
 await s.request(owner,'POST','/reviews/preview',{plan_id:p.id,start_date:'2026-10-19',end_date:'2026-10-19'});
 assert.equal(JSON.stringify(await repo.getActionWorkspace(owner)),before);
});
