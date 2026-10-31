import test from 'node:test';import assert from 'node:assert/strict';
import {createApplication} from '../support/create-test-application.ts';
import {ActionSourceService} from '../../src/modules/lighttick/actions/action-source.service.ts';
const secret='TEST_ONLY_SOURCE_DELIVERY_SECRET_0123456789';
test('verified source event is durable, deduplicated and reconciles after a running session',async()=>{
 const runtime=await createApplication({lighttickEnabled:true}),repo=runtime.services.lighttickRuntime!.repository;
 const {ActionService}=await import('../../src/modules/lighttick/actions/action.service.ts');
 let now=new Date('2026-10-21T10:00:00Z');const actions=new ActionService(repo,()=>now),sources=new ActionSourceService(actions,secret,()=>now);
 const owner={appId:'lighttick',userId:'source-owner'} as const,link={...owner,source_account_id:'grow-user',binding_id:'binding-source-test',phase:'active' as const};
 await repo.saveActionLink(link);
 const target={kind:'article',course:'article-source-test'};
 // Inventory is not browser writable. Only this fixture seeds a pre-existing arrangement.
 const row=await actions.readWorkspace(owner);row.data.content_sources=[target];await repo.saveActionWorkspace(row);
 const plan=(await actions.request(owner,'POST','/schedules',{key:'source-arrange-1',title:'Read',date:'2026-10-21',target}) as any).plan;
 await assert.rejects(sources.context(link,{action_schema_version:'2',binding_id:link.binding_id,origin_action_id:plan.id,normalized_target:target}),e=>(e as any).code==='CONTRACT_UPGRADE_REQUIRED');
 const context=await sources.context(link,{action_schema_version:2,binding_id:link.binding_id,origin_action_id:plan.id,normalized_target:target});
 const start=await actions.request(owner,'POST',`/${plan.id}/operations`,{key:'source-start-1',revision:plan.revision,action:'start'}) as any;
 const event={event_id:'source-'+ 'a'.repeat(32),normalized_target:target,confirmed_at:now.toISOString(),origin_action_id:plan.id,origin_context:context.origin_context,source_proof:{version:1,confirmation:'article_read'}};
 const input={action_schema_version:2,binding_id:link.binding_id,event};
 const accepted=await sources.receive(link,input);assert.equal(accepted.status,'pending');assert.equal(accepted.reason,'RUNNING_CONFLICT');
 assert.deepEqual(await sources.receive(link,input),accepted);
 await assert.rejects(sources.receive(link,{...input,event:{...event,confirmed_at:'2026-10-21T10:00:01Z'}}),e=>(e as any).statusCode===409);
 assert.equal((await actions.request(owner,'GET','/records') as any).total,1);
 await actions.request(owner,'POST',`/${plan.id}/operations`,{key:'source-finish-1',revision:start.plan.revision,action:'finish',execution_id:start.execution.id,actual_minutes:7});
 now=new Date('2026-10-22T10:00:00Z');
 const restarted=new ActionSourceService(new ActionService(repo,()=>now),secret,()=>now);
 const done=await restarted.reconcile(link,{action_schema_version:2,binding_id:link.binding_id,event_id:event.event_id});
 assert.equal(done.status,'completed');assert.deepEqual(done.completed_arrangements,[plan.id]);
 assert.deepEqual(await restarted.receive(link,input),done);
 const facts=(await actions.request(owner,'GET','/records') as any).records;
 assert.equal(facts.length,2);assert.equal(facts.find((r:any)=>r.record_kind==='completion').business_date,'2026-10-21');
 assert.equal(facts.reduce((n:number,r:any)=>n+r.actual_minutes,0),7);
 await assert.rejects(restarted.receive({...link,source_account_id:'other'},input),e=>(e as any).statusCode===404);
 const foreign={...link,userId:'other-owner',source_account_id:'other-bound-grow',binding_id:'binding-other-owner'};
 await repo.saveActionLink(foreign);
 await assert.rejects(restarted.receive(foreign,{...input,binding_id:foreign.binding_id}),e=>(e as any).statusCode===422);
 assert.equal((await actions.request(foreign,'GET','/records') as any).total,0);
 await assert.rejects(restarted.receive(link,{...input,event:{...event,event_id:'source-'+'b'.repeat(32),source_proof:{version:1,confirmation:'notes_saved'}}}),e=>(e as any).statusCode===422);
});

test('unscoped confirmation consumes one matching occurrence only and private proof cannot be injected',async()=>{
 const runtime=await createApplication({lighttickEnabled:true}),repo=runtime.services.lighttickRuntime!.repository;
 const {ActionService}=await import('../../src/modules/lighttick/actions/action.service.ts');
 const now=new Date('2026-10-21T10:00:00Z'),actions=new ActionService(repo,()=>now),sources=new ActionSourceService(actions,secret,()=>now);
 const owner={appId:'lighttick',userId:'source-date-owner'} as const,link={...owner,source_account_id:'grow-date-user',binding_id:'binding-date-test',phase:'active' as const};
 await repo.saveActionLink(link);const target={kind:'plan',plan_id:'plan-source-date',lesson_no:1};
 const row=await actions.readWorkspace(owner);row.data.content_sources=[target];row.version++;await repo.saveActionWorkspace(row);
 const plans=[];
 for(const [i,date] of ['2026-10-20','2026-10-21','2026-10-22',null].entries())plans.push((await actions.request(owner,'POST','/schedules',{key:'source-dates-'+i,title:'Read',date,target}) as any).plan);
 const competing=(await actions.request(owner,'POST','/schedules',{key:'source-dates-competing-zone',title:'Same source, another zone',date:'2026-10-21',timezone:'UTC',target}) as any).plan;
 const event={event_id:'source-'+'c'.repeat(32),normalized_target:target,confirmed_at:now.toISOString(),source_proof:{version:1,confirmation:'lesson_completed'}};
 const input={action_schema_version:2,binding_id:link.binding_id,event};
 const results=await Promise.all([sources.receive(link,input),sources.receive(link,input)]);
 assert.deepEqual(results[0],results[1]);assert.equal(results[0].completed_arrangements.length,1);assert.ok([plans[1].id,competing.id].includes(results[0].completed_arrangements[0]));
 const w=(await repo.getActionWorkspace(owner))!.data;assert.equal(w.records.length,1);
 assert.equal(w.plans.filter(p=>[plans[1].id,competing.id].includes(p.id)&&p.status==='active').length,1);
 for(const p of [plans[0],plans[2],plans[3]])assert.equal(w.plans.find(x=>x.id===p.id)!.status,'active');
 for(const update of [{origin_action_id:false},{origin_action_id:''},{origin_context:null},{confirmed_at:'2026-02-30T12:00:00Z'},{owner_id:'another-user'},{consumed_by:plans[0].id},{private_note:'MUST_NOT_CROSS'},{source_proof:{version:1,confirmation:'lesson_completed',readable:true}}]){
  await assert.rejects(sources.receive(link,{...input,event:{...event,event_id:'source-'+'d'.repeat(32),...update}}),e=>(e as any).statusCode===422);
 }
 // A future/undated signed origin still cannot authorize a completion.
 for(const p of [plans[2],plans[3]]){
  const context=await sources.context(link,{action_schema_version:2,binding_id:link.binding_id,origin_action_id:p.id,normalized_target:target});
  const r=await sources.receive(link,{...input,event:{...event,event_id:'source-'+(p===plans[2]?'e':'f').repeat(32),origin_action_id:p.id,origin_context:context.origin_context}});
  assert.equal(r.status,'pending');assert.deepEqual(r.completed_arrangements,[]);
 }
 assert.equal((await repo.getActionWorkspace(owner))!.data.records.length,1);
});
