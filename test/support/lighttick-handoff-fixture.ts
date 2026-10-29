/** Disposable stdin fixture: never imported by runtime or connected to production. */
import {Pool} from 'pg';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';
import {LightTickActionHandoffSnapshotSchema} from '../../src/generated/openapi/public-contracts.generated.ts';
import {randomUUID} from 'node:crypto';
import {readFile} from 'node:fs/promises';
import assert from 'node:assert/strict';
import {ActionService} from '../../src/modules/lighttick/actions/action.service.ts';
import {ActionLinkService} from '../../src/modules/lighttick/actions/action-link.service.ts';
import {ActionHandoffService} from '../../src/modules/lighttick/actions/action-handoff.service.ts';
import {PostgresLightTickRepository} from '../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts';
import {digest} from '../../src/modules/lighttick/actions/action.validation.ts';
const url=process.env.LIGHTTICK_ACTION_TEST_DATABASE_URL;
if(!url||!['127.0.0.1','localhost'].includes(new URL(url).hostname))throw Error('Explicit disposable localhost database required');
let raw='';for await(const part of process.stdin)raw+=part;
const snapshot=JSON.parse(raw);
const ajv=new Ajv2020({strict:false,allErrors:true});addFormats(ajv);
const validate=ajv.compile(LightTickActionHandoffSnapshotSchema);assert.equal(validate(snapshot),true,JSON.stringify(validate.errors));
const schema='handoff_test_'+randomUUID().replaceAll('-',''),admin=new Pool({connectionString:url});
await admin.query('CREATE SCHEMA '+schema);
const pool=new Pool({connectionString:url,options:'-c search_path='+schema,max:5});
try{
 const migration=await readFile(new URL('../../src/infrastructure/database/postgres/migrations/074_lighttick_action_workspaces.sql',import.meta.url),'utf8');await pool.query(migration);
 const operations=await readFile(new URL('../../src/infrastructure/database/postgres/migrations/031_lighttick_sync_devices.sql',import.meta.url),'utf8');
 await pool.query(operations.match(/CREATE TABLE IF NOT EXISTS zook_lighttick_operations[\s\S]+?\n\);/)![0]);
 const owner={appId:'lighttick',userId:'handoff-postgres'} as const,repo=new PostgresLightTickRepository(pool),clock=()=>new Date('2026-10-21T12:00:00Z');
 const actions=new ActionService(repo,clock),links=new ActionLinkService(actions,'fixture-secret-012345678901234567890123456789',clock),ticket=await links.ticket(owner),link=await links.claim(ticket.code,snapshot.source_account_id);
 const service=new ActionHandoffService(links),input={snapshot,snapshot_hash:digest(snapshot),binding_id:link.binding_id};
 const preflight=await service.preflight(snapshot.source_account_id,input),request={...input,target_version:preflight.target_version},before=await repo.getActionWorkspace(owner);
 const save=repo.saveActionLink.bind(repo);repo.saveActionLink=async()=>{throw Error('receipt write failure');};
 await assert.rejects(service.import(snapshot.source_account_id,request),/receipt write failure/);
 assert.deepEqual(await repo.getActionWorkspace(owner),before);repo.saveActionLink=save;
 // Concurrent same-package requests serialize under the real owner lock.
 const both=await Promise.all([service.import(snapshot.source_account_id,request),service.import(snapshot.source_account_id,request)]);
 assert.deepEqual(both[0],both[1]);
 const freshRepo=new PostgresLightTickRepository(pool),freshActions=new ActionService(freshRepo,clock),freshLinks=new ActionLinkService(freshActions,links.secret,clock);
 assert.deepEqual(await new ActionHandoffService(freshLinks).import(snapshot.source_account_id,request),both[0]);
 const stored=(await freshRepo.getActionWorkspace(owner))!.data;
 assert.deepEqual(stored.plans,snapshot.plans);assert.deepEqual(stored.records,snapshot.records);
 assert.equal(stored.content_events!.length,snapshot.content_events.length);
 for(const e of stored.content_events!){assert.equal(e.owner_id,owner.userId);assert.equal(e.consumed_by,snapshot.content_events.find((v:any)=>v.event_id===e.event_id).consumed_by);}
 for(const op of snapshot.operations)assert.deepEqual(await freshActions.request(owner,'GET','/requests/'+op.key),{found:true,result:op.result});
 assert.equal((await freshActions.request({...owner,userId:'another-owner'},'GET','') as any).plans.length,0);
 assert.equal((await freshActions.request(owner,'GET','') as any).execution.outcome,'running');
 console.log('C3_POSTGRES_RECOVERY_OK '+JSON.stringify({plans:stored.plans.length,records:stored.records.length,events:stored.content_events!.length}));
}finally{await pool.end();await admin.query('DROP SCHEMA '+schema+' CASCADE');await admin.end();}
