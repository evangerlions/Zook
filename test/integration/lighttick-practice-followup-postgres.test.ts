import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Pool} from 'pg';
import {PostgresLightTickRepository} from '../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts';
import {runPostgresMigrations} from '../../src/infrastructure/database/postgres/migrate.ts';
import {LightTickRecordService} from '../../src/modules/lighttick/lighttick-record.service.ts';
import {ActionService} from '../../src/modules/lighttick/actions/action.service.ts';
const connectionString=process.env.LIGHTTICK_TEST_DATABASE_URL;
if(!connectionString||!['127.0.0.1','localhost'].includes(new URL(connectionString).hostname))throw Error('Explicit disposable localhost PostgreSQL required');
test('follow-up origin, immutable retry and failed receipt rollback survive real PostgreSQL reconnect',async()=>{
 await runPostgresMigrations({connectionString,log:()=>{}});const pool=new Pool({connectionString,max:5}),repo=new PostgresLightTickRepository(pool),owner={appId:'lighttick' as const,userId:'followup-pg-'+randomUUID()};
 const records=new LightTickRecordService(repo),actions=new ActionService(repo,undefined,undefined,true);
 try{
  const record=await records.mutate(owner,'record-followup-pg','save',{raw_text:'Private original',record_date:'2026-10-30',base_version:0},'record-followup-pg-create');
  let p=(await actions.request(owner,'POST','/practices',{key:'practice-followup-pg-create',title:'First attempt',source_kind:'record',source_id:record.id,source_version:'1',date:null}) as any).plan;
  p=(await actions.request(owner,'POST',`/${p.id}/operations`,{key:'practice-followup-pg-feedback',revision:1,action:'practice-feedback',feedback:{outcome:'unknown',result:'Ask for feedback',next_step:'One more attempt'}}) as any).plan;
  const path='/practices/'+p.id+'/follow-up',body={key:'practice-followup-pg-next',revision:p.revision,feedback_id:p.practice_feedback[0].id,source_version:'1',title:'One more attempt',date:null};
  const result=await actions.request(owner,'POST',path,body) as any;
  const freshRepo=new PostgresLightTickRepository(pool),fresh=new ActionService(freshRepo,undefined,undefined,true);
  assert.deepEqual(await fresh.request(owner,'POST',path,body),result);
  const save=repo.saveOperation.bind(repo);repo.saveOperation=async operation=>{if(operation.operationId==='action:practice-followup-pg-rollback')throw Error('Injected receipt failure');return save(operation)};
  await assert.rejects(actions.request(owner,'POST',path,{...body,key:'practice-followup-pg-rollback',title:'Must roll back'}),/Injected receipt/);
  assert.equal((await fresh.readWorkspace(owner)).data.plans.length,2);
  await records.mutate(owner,record.id,'archive',{base_version:1},'record-followup-pg-archive');
  assert.deepEqual(await fresh.request(owner,'POST',path,body),result);
  assert.equal((await fresh.readWorkspace(owner)).data.records.length,0);assert.deepEqual(result.plan.practice_origin,{plan_id:p.id,feedback_id:body.feedback_id});
 }finally{await repo.deleteOwnerData(owner);await pool.end();}
});
