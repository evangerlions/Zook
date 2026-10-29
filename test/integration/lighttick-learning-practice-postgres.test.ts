import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {PostgresLightTickRepository} from '../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts';
import {runPostgresMigrations} from '../../src/infrastructure/database/postgres/migrate.ts';
import {ActionService} from '../../src/modules/lighttick/actions/action.service.ts';
import {LightTickRecordService} from '../../src/modules/lighttick/lighttick-record.service.ts';
const connectionString=process.env.LIGHTTICK_TEST_DATABASE_URL;
if(!connectionString||!['127.0.0.1','localhost'].includes(new URL(connectionString).hostname))throw Error('Explicit disposable localhost PostgreSQL required');
test('practice receipts survive reconnect; record locks serialize source archive, rollback and deletion',async()=>{
 await runPostgresMigrations({connectionString,log:()=>{}});
 const pool=new Pool({connectionString,max:5}),repo=new PostgresLightTickRepository(pool),otherRepo=new PostgresLightTickRepository(pool);
 const owner={appId:'lighttick',userId:'practice-pg-'+randomUUID()} as const;
 const records=new LightTickRecordService(repo),actions=new ActionService(repo,undefined,undefined,true),fresh=new ActionService(otherRepo,undefined,undefined,true);
 try{
  const r=await records.mutate(owner,'practice-pg-record','save',{raw_text:'Private source text',record_date:'2026-10-29',base_version:0},'practice-pg-record-create');
  const body={key:'practice-pg-create',title:'Use the idea',source_kind:'record',source_id:r.id,source_version:String(r.version),date:null};
  const results=await Promise.all([actions.request(owner,'POST','/practices',body),fresh.request(owner,'POST','/practices',body)]) as any[];
  assert.equal(results[0].plan.id,results[1].plan.id);
  const p=results[0].plan;assert.equal((await fresh.request(owner,'GET','/practices') as any).practices.length,1);
  const save=repo.saveOperation.bind(repo);repo.saveOperation=async()=>{throw Error('synthetic receipt failure')};
  const feedback={key:'practice-pg-feedback',revision:p.revision,action:'practice-feedback',feedback:{outcome:'unknown',result:'Tried it'}};
  await assert.rejects(actions.request(owner,'POST',`/${p.id}/operations`,feedback),/synthetic receipt failure/);repo.saveOperation=save;
  assert.equal((await fresh.request(owner,'GET','/practices') as any).practices[0].practice_feedback.length,0);
  await fresh.request(owner,'POST',`/${p.id}/operations`,feedback);
  assert.equal((await new ActionService(new PostgresLightTickRepository(pool)).request(owner,'GET','/practices') as any).practices[0].practice_feedback.length,1);

  let release!:()=>void,locked!:()=>void,attempted!:()=>void;
  const gate=new Promise<void>(r=>release=r),ready=new Promise<void>(r=>locked=r),trying=new Promise<void>(r=>attempted=r);
  const holding=repo.transaction(owner,async()=>{await repo.lockRecordOwner(owner);locked();await gate;await records.mutate(owner,r.id,'archive',{base_version:r.version},'practice-pg-archive');});
  await ready;const lock=otherRepo.lockRecordOwner.bind(otherRepo);otherRepo.lockRecordOwner=async o=>{attempted();await lock(o)};
  const blocked=assert.rejects(fresh.request(owner,'POST','/practices',{...body,key:'practice-pg-new-after-archive'}));await trying;release();await holding;await blocked;
  assert.deepEqual(await fresh.request(owner,'POST','/practices',body),results[0]);
  assert.equal((await fresh.request(owner,'GET','/records') as any).total,0);
  await repo.deleteOwnerData(owner);assert.equal((await fresh.request(owner,'GET','/practices') as any).practices.length,0);
  assert.equal((await fresh.request(owner,'GET','/requests/'+body.key) as any).found,false);
 }finally{await repo.deleteOwnerData(owner);await pool.end();}
});
