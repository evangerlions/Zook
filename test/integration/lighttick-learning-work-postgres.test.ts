import test from 'node:test';
import assert from 'node:assert/strict';
import {Pool} from 'pg';
import {runPostgresMigrations} from '../../src/infrastructure/database/postgres/migrate.ts';
import {PostgresLightTickRepository} from '../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts';
import {NativeLearningService} from '../../src/modules/lighttick/learning/native-learning.service.ts';
import {LearningRouteService} from '../../src/modules/lighttick/learning/learning-route.service.ts';
import {LearningWorkService} from '../../src/modules/lighttick/learning/learning-work.service.ts';
import {LearningWorkRunner} from '../../src/modules/lighttick/learning/learning-work.runner.ts';
import {InMemoryJobQueue} from '../../src/infrastructure/queue/bullmq/in-memory-queue.ts';
import {routeFixture} from '../support/learning-route-fixture.ts';
const dsn=process.env.LIGHTTICK_TEST_DATABASE_URL;
if(!dsn||!['localhost','127.0.0.1'].includes(new URL(dsn).hostname)||!new URL(dsn).pathname.startsWith('/grow_web_u1_'))throw Error('Disposable synthetic Grow database required');
test('PostgreSQL work outbox, lease recovery, fencing, explicit adoption and deletion survive repository reconnect',async()=>{
 await runPostgresMigrations({connectionString:dsn,log:()=>{}});
 const pool=new Pool({connectionString:dsn,max:8}),owner={appId:'lighttick' as const,userId:'work-pg-'+process.pid},routeId='plan-work-pg';
 let now=new Date('2026-11-04T08:00:00Z');
 const create=()=>{const repo=new PostgresLightTickRepository(pool),native=new NativeLearningService(repo,true,()=>now),queue=new InMemoryJobQueue(),work=new LearningWorkService(new LearningRouteService(native),queue);return {repo,native,queue,work};};
 const first=create(),second=create();let calls=0;
 const adapters={readFile:async()=>{throw Error('No source file');},fetchUrl:async()=>{throw Error('No external request');}};
 try{
  first.queue.markNextAddAsFailure();const job=await first.work.create(owner,{kind:'route_draft',route_id:routeId,base_revision:0,brief:routeFixture().brief},'work-pg-original');
  assert.equal((await second.work.read(owner,job.id)).error_code,'QUEUE_UNAVAILABLE');
  const llm={complete:async()=>{
   calls++;let timer:ReturnType<typeof setTimeout>|undefined;
   try{await Promise.race([second.repo.transaction(owner,async()=>second.repo.getProfile(owner)),new Promise((_,reject)=>{timer=setTimeout(()=>reject(Error('Model IO held the owner transaction')),1500);})]);}finally{if(timer)clearTimeout(timer);}
   return {text:JSON.stringify(routeFixture().document),provider:'synthetic',providerModel:'fixture'};
  }} as any;
  const runner=new LearningWorkRunner(second.work,llm,adapters);
  assert.equal(await runner.recover(),1);await runner.execute(owner,job.id);
  const done=await first.work.read(owner,job.id);assert.equal(done.status,'succeeded');assert.equal(calls,1);
  const adopted=await second.work.adopt(owner,job.id,{base_revision:done.revision,base_route_revision:0,expected_digest:done.output_digest},'work-pg-adopt');
  assert.equal(adopted.result.status,'draft');assert.equal(adopted.result.published_version,0);
  assert.deepEqual(await first.work.adopt(owner,job.id,{base_revision:done.revision,base_route_revision:0,expected_digest:done.output_digest},'work-pg-adopt'),adopted);
  const collect=await first.work.create(owner,{kind:'collect_sources',route_id:routeId,base_revision:1,sources:[{kind:'text',title:'Synthetic',text:'Reviewed source'}]},'work-pg-lease');
  const row=(await first.work.store.get(owner,collect.id))!;
  await first.work.store.save({...row,revision:row.revision+1,status:'running',attempt:1,fence:'old-process',leaseUntil:new Date(now.getTime()+1000).toISOString()},row.revision);
  now=new Date(now.getTime()+2000);assert.equal(await runner.recover(),1);await runner.execute(owner,collect.id);
  assert.equal((await first.work.read(owner,collect.id)).attempt,2);assert.equal((await first.work.read(owner,collect.id)).output!.sources[0].content,'Reviewed source');
  await first.repo.deleteOwnerData(owner);assert.equal(await second.work.store.get(owner,job.id),undefined);
  await runner.execute(owner,job.id);assert.equal(await second.repo.getLearningAuthority(owner),undefined,'deleted owner is never recreated by a late job');
 }finally{await first.repo.deleteOwnerData(owner);await pool.end();}
});
