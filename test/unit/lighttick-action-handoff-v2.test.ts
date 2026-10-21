import test from 'node:test';
import assert from 'node:assert/strict';
import {InMemoryLightTickRepository} from '../../src/testing/in-memory-lighttick-repository.ts';
import {ActionService} from '../../src/modules/lighttick/actions/action.service.ts';
import {ActionLinkService} from '../../src/modules/lighttick/actions/action-link.service.ts';
import {ActionHandoffService} from '../../src/modules/lighttick/actions/action-handoff.service.ts';
import {digest} from '../../src/modules/lighttick/actions/action.validation.ts';
const owner={appId:'lighttick',userId:'handoff-v2'} as const;
const now=()=>new Date('2026-10-21T12:00:00Z');
export async function fixture(repository=new InMemoryLightTickRepository()){
 const actions=new ActionService(repository,now),links=new ActionLinkService(actions,'fixture-only-012345678901234567890123456789',now);
 const ticket=await links.ticket(owner),link=await links.claim(ticket.code,'grow-handoff');
 const sourceRepo=new InMemoryLightTickRepository(),source=new ActionService(sourceRepo,now);
 const create=async(key:string,patch={})=>((await source.request(owner,'POST','',{key,title:'接管测试',period:'day',completion_mode:'check',start_date:'2026-10-21',end_date:'2026-10-21',...patch})) as any).plans[0];
 const check=await create('source-create-check');
 const mutate=async(p:any,action:string,key:string,patch={})=>source.request(owner,'POST',`/${p.id}/operations`,{key,revision:p.revision,action,...patch}) as Promise<any>;
 let result=await mutate(check,'complete','source-check-complete');
 result=await mutate(result.plan,'reopen','source-check-reopen');
 const undated=await create('source-create-undated',{start_date:null,end_date:null});
 const timed=await create('source-create-time',{completion_mode:'time'});
 await mutate(timed,'start','source-running-start');
 const data=(await sourceRepo.getActionWorkspace(owner))!.data;
 const snapshot:any={snapshot_version:2,source_account_id:'grow-handoff',plans:data.plans,records:data.records,reviews:[],reports:[],operations:[{key:'old-grow-key',hash:'a'.repeat(64),result:{plans:[undated]}}],claims:[{key:'reminder-old',claimed_at:now().toISOString()}],content_sources:[],content_events:[]};
 const service=new ActionHandoffService(links);
 const input=()=>({snapshot,snapshot_hash:digest(snapshot),binding_id:link.binding_id});
 return {repository,actions,links,link,snapshot,service,input};
}
test('v2 preflight is read-only; complete/reversal/nullable/running and receipts survive exact replay',async()=>{
 const f=await fixture(),before=await f.repository.getActionWorkspace(owner),pre=await f.service.preflight('grow-handoff',f.input());
 assert.deepEqual(await f.repository.getActionWorkspace(owner),before);assert.equal((await f.links.linked('grow-handoff')).phase,'staged');
 const request={...f.input(),target_version:pre.target_version};
 const receipt=await f.service.import('grow-handoff',request);
 assert.deepEqual(await f.service.import('grow-handoff',request),receipt);
 const w=(await f.repository.getActionWorkspace(owner))!.data;
 assert.deepEqual(w.plans,f.snapshot.plans);assert.deepEqual(w.records,f.snapshot.records);
 assert.equal((await f.actions.request(owner,'GET','/requests/old-grow-key') as any).found,true);
 assert.equal((await f.actions.request(owner,'GET','') as any).execution.outcome,'running');
 assert.equal(w.claims['reminder-old'],now().toISOString());
 assert.equal(receipt.source_counts.records,3);
 await assert.rejects(f.actions.request(owner,'POST','',{key:'old-grow-key'}),/接管前/);
});
test('invalid graph/hash/identity/colliding receipts/stale preflight leaves staged workspace untouched',async()=>{
 for(const change of [
  (s:any)=>{s.records[0].plan_id='action-missing';},
  (s:any)=>{s.records[1].reverses_record_id='execution-missing';},
  (s:any)=>{s.plans[0].completion_record_id=s.records[0].id;},
  (s:any)=>{s.source_account_id='another-account';},
  (s:any)=>{s.records.push({...s.records[2],id:'execution-second-running'});},
  (s:any)=>{s.operations.push({...s.operations[0]});},
  (s:any)=>{s.plans.push({...s.plans[0]});},
 ]){
  const f=await fixture(),before=await f.repository.getActionWorkspace(owner);change(f.snapshot);
  await assert.rejects(f.service.preflight('grow-handoff',f.input()));
  assert.deepEqual(await f.repository.getActionWorkspace(owner),before);
  assert.equal((await f.links.linked('grow-handoff')).phase,'staged');
 }
 const f=await fixture(),pre=await f.service.preflight('grow-handoff',f.input());
 await f.actions.request(owner,'POST','',{key:'target-changed-key',title:'目标新增',period:'day',completion_mode:'check'});
 await assert.rejects(f.service.import('grow-handoff',{...f.input(),target_version:pre.target_version}),/预检/);
 await assert.rejects(f.service.preflight('grow-handoff',{...f.input(),snapshot_hash:'b'.repeat(64)}),/校验/);
 f.snapshot.operations[0].key='target-changed-key';
 await assert.rejects(f.service.preflight('grow-handoff',f.input()),/请求编号/);
});
test('receipt persistence failure rolls back graph; retry after service restart imports once',async()=>{
 const f=await fixture(),pre=await f.service.preflight('grow-handoff',f.input()),before=await f.repository.getActionWorkspace(owner);
 const save=f.repository.saveActionLink.bind(f.repository);f.repository.saveActionLink=async()=>{throw Error('receipt disk failure');};
 const input={...f.input(),target_version:pre.target_version};
 await assert.rejects(f.service.import('grow-handoff',input),/receipt disk failure/);
 assert.deepEqual(await f.repository.getActionWorkspace(owner),before);
 f.repository.saveActionLink=save;
 const restarted=new ActionHandoffService(new ActionLinkService(new ActionService(f.repository,now),'fixture-only-012345678901234567890123456789',now));
 const receipt=await restarted.import('grow-handoff',input);assert.deepEqual(await restarted.import('grow-handoff',input),receipt);
});

test('imported unconsumed evidence maps owner and reconciles exactly once; forged consumption is rejected',async()=>{
 const build=async()=>{
  const f=await fixture(),p={...f.snapshot.plans[0],id:'action-imported-content',completion_mode:'content',target:{kind:'article',course:'article-handoff'},target_minutes:null,minimum_minutes:null};
  f.snapshot.plans.push(p);f.snapshot.content_sources=[p.target];
  f.snapshot.content_events=[{event_id:'source-'+ 'c'.repeat(32),owner:'grow-handoff',normalized_target:p.target,confirmed_at:now().toISOString(),origin_action_id:p.id,planned_date_at_confirmation:p.start_date,timezone_at_confirmation:p.timezone,request_key:'source-confirmation-key',request_hash:'c'.repeat(64)}];
  return {...f,p};
 };
 for(const change of [(e:any)=>{e.owner='foreign';},(e:any)=>{e.consumed_by='action-missing';},(e:any)=>{e.origin_action_id='action-missing';},(e:any)=>{e.delivery_hash='forged';}]){
  const f=await build();change(f.snapshot.content_events[0]);await assert.rejects(f.service.preflight('grow-handoff',f.input()));
 }
 const f=await build(); // Running is unrelated to this content; only its own session blocks completion.
 const pre=await f.service.preflight('grow-handoff',f.input());await f.service.import('grow-handoff',{...f.input(),target_version:pre.target_version});
 const body={key:'imported-reconcile-key',revision:f.p.revision,action:'reconcile-content',source_event_id:f.snapshot.content_events[0].event_id};
 const result=await f.actions.request(owner,'POST',`/${f.p.id}/operations`,body) as any;
 assert.equal(result.plan.status,'completed');assert.equal(result.execution.actual_minutes,0);
 assert.deepEqual(await f.actions.request(owner,'POST',`/${f.p.id}/operations`,body),result);
 const event=(await f.repository.getActionWorkspace(owner))!.data.content_events![0];
 assert.equal(event.consumed_by,f.p.id);assert.equal(event.owner_id,owner.userId);
 assert.deepEqual(event.handoff_source,{account_id:'grow-handoff',request_key:'source-confirmation-key',request_hash:'c'.repeat(64)});
});
test('v1 raw facts and archived parent relationships survive mixed-version import unchanged',async()=>{
 const f=await fixture(),legacy:any={...f.snapshot.plans[2],id:'action-legacy',status:'completed'};
 for(const key of ['schema_version','completion_record_id','completed_at','estimated_minutes','completion_mode'])delete legacy[key];
 const record:any={...f.snapshot.records[2],id:'execution-legacy',plan_id:legacy.id,ended_at:now().toISOString(),actual_minutes:20,outcome:'completed'};
 for(const key of ['schema_version','record_kind','completion_mode','completion_effect','planned_date','date_basis'])delete record[key];
 const parent={...f.snapshot.plans[2],id:'action-archived-parent',period:'week',end_date:'2026-10-25',status:'archived'};
 f.snapshot.plans[0].parent_id=parent.id;f.snapshot.plans.push(legacy,parent);f.snapshot.records.push(record);
 f.snapshot.reviews=[{id:'review-historical',plan_id:legacy.id,start_date:'2026-10-21',end_date:'2026-10-21',created_at:now().toISOString(),worked:'历史快照',stats:{minutes:99,completed:7}}];
 f.snapshot.reports=[{id:'report-historical',plan_id:legacy.id,start_date:'2026-10-21',end_date:'2026-10-21',created_at:now().toISOString(),state:'ready',text:'保留旧总结',snapshot:{stats:{minutes:99,completed:7}}}];
 const pre=await f.service.preflight('grow-handoff',f.input());await f.service.import('grow-handoff',{...f.input(),target_version:pre.target_version});
 const w=(await f.repository.getActionWorkspace(owner))!.data;
 assert.deepEqual(w.plans.find(p=>p.id===legacy.id),legacy);assert.deepEqual(w.records.find(p=>p.id===record.id),record);
 assert.deepEqual(w.reviews,f.snapshot.reviews);assert.deepEqual(w.reports,f.snapshot.reports);
});


test('arbitrary old request keys remain exact own properties, without prototype receipts',async()=>{
 const f=await fixture();
 for(const key of ['__proto__','constructor','toString'])f.snapshot.operations.push({key,hash:'d'.repeat(64),result:{key}});
 f.snapshot.claims.push({key:'__proto__',claimed_at:now().toISOString()});
 const pre=await f.service.preflight('grow-handoff',f.input());await f.service.import('grow-handoff',{...f.input(),target_version:pre.target_version});
 for(const key of ['__proto__','constructor','toString'])assert.deepEqual(await f.actions.request(owner,'GET','/requests/'+key),{found:true,result:{key}});
 assert.deepEqual(await f.actions.request(owner,'GET','/requests/valueOf'),{found:false,result:null});
 assert.equal(Object.getPrototypeOf((await f.repository.getActionWorkspace(owner))!.data.legacy_operations),Object.prototype);
});
