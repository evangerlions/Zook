import test from 'node:test';import assert from 'node:assert/strict';import {Pool} from 'pg';import {randomUUID} from 'node:crypto';import {readFile} from 'node:fs/promises';
import {ActionService} from '../../src/modules/lighttick/actions/action.service.ts';import {PostgresLightTickRepository} from '../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts';
const connectionString=process.env.LIGHTTICK_ACTION_TEST_DATABASE_URL;
if(!connectionString||!['127.0.0.1','localhost'].includes(new URL(connectionString).hostname))throw Error('Requires explicit disposable localhost PostgreSQL configuration');
test('real PostgreSQL action upgrade, concurrent transaction, restart recovery and account isolation',async()=>{
 const schema='action_test_'+randomUUID().replaceAll('-',''),admin=new Pool({connectionString});await admin.query('CREATE SCHEMA '+schema);
 const pool=new Pool({connectionString,options:'-c search_path='+schema,max:5});
 try{
  const migration=await readFile(new URL('../../src/infrastructure/database/postgres/migrations/074_lighttick_action_workspaces.sql',import.meta.url),'utf8');await pool.query(migration);await pool.query(migration);
  const operations=await readFile(new URL('../../src/infrastructure/database/postgres/migrations/031_lighttick_sync_devices.sql',import.meta.url),'utf8');
  await pool.query(operations.match(/CREATE TABLE IF NOT EXISTS zook_lighttick_operations[\s\S]+?\n\);/)![0]);
  const owner={appId:'lighttick',userId:'alice'} as const,repo=new PostgresLightTickRepository(pool),service=new ActionService(repo,()=>new Date('2026-10-19T12:00:00Z'));
  const create=async(key:string,values={})=>(await service.request(owner,'POST','',{key,title:'先读书',period:'day',start_date:'2026-10-19',end_date:'2026-10-19',...values}) as any).plans[0];
  const a=await create('postgres-create-a'),b=await create('postgres-create-b');
  const start=(p:any,key:string)=>service.request(owner,'POST',`/${p.id}/operations`,{key,action:'start',revision:1});
  const starts=await Promise.allSettled([start(a,'postgres-start-a'),start(b,'postgres-start-b')]);assert.equal(starts.filter(r=>r.status==='fulfilled').length,1);
  const fresh=new ActionService(new PostgresLightTickRepository(pool),()=>new Date('2026-10-19T12:00:00Z')),snapshot=await fresh.request(owner,'GET','') as any;
  assert.equal(snapshot.plans.length,2);assert.ok(snapshot.execution);assert.deepEqual((await fresh.request({...owner,userId:'bob'},'GET','') as any).plans,[]);
  const pid=snapshot.execution.plan_id,p=snapshot.plans.find((p:any)=>p.id===pid),body={key:'postgres-finish',revision:p.revision,action:'finish',execution_id:snapshot.execution.id,actual_minutes:20};
  const result=await fresh.request(owner,'POST',`/${pid}/operations`,body);assert.deepEqual(await fresh.request(owner,'POST',`/${pid}/operations`,body),result);
  assert.equal((await fresh.request(owner,'GET','/records') as any).total,1);
  await assert.rejects(repo.transaction(owner,async()=>{await repo.lockActionOwner(owner);const row=(await repo.getActionWorkspace(owner))!;row.data.plans=[];await repo.saveActionWorkspace(row);throw Error('rollback');}),/rollback/);
  assert.equal((await fresh.request(owner,'GET','') as any).plans.length,2);
  const check=await create('postgres-p0-check',{completion_mode:'check'});
  const complete=(key:string)=>service.request(owner,'POST',`/${check.id}/operations`,{key,revision:check.revision,action:'complete'});
  const checks=await Promise.allSettled([complete('postgres-p0-check-a'),complete('postgres-p0-check-b')]);
  assert.equal(checks.filter(r=>r.status==='fulfilled').length,1);
  let current=(await service.request(owner,'GET','') as any).plans.find((p:any)=>p.id===check.id);
  await service.request(owner,'POST',`/${check.id}/operations`,{key:'postgres-p0-reopen',revision:current.revision,action:'reopen'});
  current=(await service.request(owner,'GET','') as any).plans.find((p:any)=>p.id===check.id);assert.equal(current.progress.completed,0);
  const originalSave=repo.saveOperation.bind(repo),before=JSON.stringify(await repo.getActionWorkspace(owner));
  repo.saveOperation=async()=>{throw Error('fixture receipt storage failure');};
  const failBody={key:'postgres-p0-atomic-check',revision:current.revision,action:'complete'};
  try{await assert.rejects(service.request(owner,'POST',`/${check.id}/operations`,failBody),/fixture receipt storage failure/);}
  finally{repo.saveOperation=originalSave;}
  assert.equal(JSON.stringify(await repo.getActionWorkspace(owner)),before,'workspace/facts must roll back when receipt persistence fails');
  assert.equal((await service.request(owner,'GET','/requests/'+failBody.key) as any).found,false);
  await service.request(owner,'POST',`/${check.id}/operations`,failBody);

  const source={kind:'plan',plan_id:'plan-postgres-p0',lesson_no:1};
  await repo.transaction(owner,async()=>{await repo.lockActionOwner(owner);const row=(await repo.getActionWorkspace(owner))!;row.data.content_sources=[source];await repo.saveActionWorkspace(row);});
  const content=await create('postgres-p0-content',{completion_mode:'content',target:source});
  await repo.transaction(owner,async()=>{await repo.lockActionOwner(owner);const row=(await repo.getActionWorkspace(owner))!;
   row.data.content_events=[{event_id:'source-postgres-p0',owner_id:owner.userId,normalized_target:source,confirmed_at:'2026-10-19T12:00:00Z',origin_action_id:content.id,planned_date_at_confirmation:content.start_date,timezone_at_confirmation:content.timezone}];await repo.saveActionWorkspace(row);});
  const reconcile={key:'postgres-p0-reconcile',revision:content.revision,action:'reconcile-content',source_event_id:'source-postgres-p0'};
  const beforeEvent=JSON.stringify(await repo.getActionWorkspace(owner));repo.saveOperation=async()=>{throw Error('fixture event receipt failure');};
  try{await assert.rejects(service.request(owner,'POST',`/${content.id}/operations`,reconcile),/fixture event receipt failure/);}
  finally{repo.saveOperation=originalSave;}
  assert.equal(JSON.stringify(await repo.getActionWorkspace(owner)),beforeEvent,'event binding, plan, fact and receipt must roll back together');
  const confirmed=await service.request(owner,'POST',`/${content.id}/operations`,reconcile) as any;
  assert.equal(confirmed.plan.status,'completed');assert.equal(confirmed.execution.actual_minutes,0);
  assert.deepEqual(await fresh.request(owner,'POST',`/${content.id}/operations`,reconcile),confirmed);
  assert.equal((await repo.getActionWorkspace(owner))!.data.content_events![0].consumed_by,content.id);
  const final=await fresh.request(owner,'GET','') as any;
  assert.equal(final.plans.find((p:any)=>p.id===content.id).progress.completed,1);
 }finally{await pool.end();await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end();}
});
