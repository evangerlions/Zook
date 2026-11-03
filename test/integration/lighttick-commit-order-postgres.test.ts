import assert from 'node:assert/strict';
import test from 'node:test';
import {Pool} from 'pg';
import {PostgresLightTickRepository} from '../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts';
import {runPostgresMigrations} from '../../src/infrastructure/database/postgres/migrate.ts';
import {LightTickGoalService} from '../../src/modules/lighttick/lighttick-goal.service.ts';
import {LightTickRecordService} from '../../src/modules/lighttick/lighttick-record.service.ts';
const dsn=process.env.LIGHTTICK_TEST_DATABASE_URL;
if(!dsn||!['127.0.0.1','localhost'].includes(new URL(dsn).hostname)||!new URL(dsn).pathname.startsWith('/grow_web_u1_'))throw Error('Disposable Grow fixture database required');
function signal(){let resolve!:()=>void;const promise=new Promise<void>(r=>{resolve=r;});return {promise,resolve};}
test('an earlier record transaction cannot be skipped by a later planning commit and cursor',async()=>{
 await runPostgresMigrations({connectionString:dsn,log:()=>{}});const pool=new Pool({connectionString:dsn,max:6}),repo=new PostgresLightTickRepository(pool),owner={appId:'lighttick' as const,userId:'commit-order-'+process.pid};
 const written=signal(),release=signal();let committed=false;
 try{
  const first=repo.transaction(owner,async()=>{await new LightTickRecordService(repo).mutate(owner,'record-commit-order','save',{base_version:0,raw_text:'Earlier uncommitted record',record_date:'2026-11-03',tags:[]},'record-write-order');written.resolve();await release.promise;});
  await written.promise;
  const other={...owner,userId:owner.userId+'-other'};
  await new LightTickGoalService(repo).create(other,{title:'Other owner stays independent',constraints:{}});
  await repo.deleteOwnerData(other);
  const later=repo.transaction(owner,async()=>{await new LightTickGoalService(repo).create(owner,{title:'Later planning write',constraints:{}});}).then(()=>{committed=true;});
  const observer=await pool.connect();try{await observer.query("SET statement_timeout='2000ms'");await observer.query('SELECT 1');}finally{observer.release();}
  // With the owner gate the later callback cannot start; without it its change is already visible.
  await Promise.race([later,new Promise(r=>setTimeout(r,500))]);
  const before=await repo.pullChanges(owner,0,100);
  assert.equal(before.length,0,'a later visible sequence would advance the cursor past the uncommitted earlier record');assert.equal(committed,false);
  release.resolve();await Promise.all([first,later]);const rows=await repo.pullChanges(owner,0,100);assert.deepEqual(rows.map(r=>r.entityType),['record','goal']);
 }finally{release.resolve();await repo.deleteOwnerData(owner);await pool.end();}
});
