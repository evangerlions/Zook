import test from 'node:test';
import assert from 'node:assert/strict';
import {createHmac} from 'node:crypto';
import {Pool} from 'pg';
import {RecordTransferService} from '../../src/modules/lighttick/records/record-transfer.service.ts';
import {LightTickRecordService,type LightTickRecord} from '../../src/modules/lighttick/lighttick-record.service.ts';
import type {RecordPackage} from '../../src/modules/lighttick/records/record-transfer.types.ts';
import {canonical,digest} from '../../src/modules/lighttick/actions/action.validation.ts';
import {PostgresLightTickRepository} from '../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts';
import {runPostgresMigrations} from '../../src/infrastructure/database/postgres/migrate.ts';
const connectionString=process.env.LIGHTTICK_TEST_DATABASE_URL;
if(!connectionString)throw new Error('Disposable LIGHTTICK_TEST_DATABASE_URL required');
test('record binding unique ownership persists and migration replay is safe',async()=>{
 await runPostgresMigrations({connectionString,log:()=>{}});
 const pool=new Pool({connectionString}),repo=new PostgresLightTickRepository(pool);
 const service=new RecordTransferService(repo,{sourceInstance:'grow-test',secret:'record-transfer-test-secret-long-enough-1234'});
 const owner={appId:'lighttick' as const,userId:'record-transfer-pg'},source={instance:'grow-test',subject:'legacy-pg'};
 try {
  await repo.deleteOwnerData(owner);
  const ticket=await service.ticket(owner);
  const results=await Promise.all([1,2].map(()=>service.claim(source,{code:ticket.code,operation_id:'transfer-operation-pg'})));
  assert.equal(results[0].binding_id,results[1].binding_id);
  const fresh=new RecordTransferService(new PostgresLightTickRepository(pool),{sourceInstance:'grow-test',secret:'record-transfer-test-secret-long-enough-1234'});
  assert.equal((await fresh.status(owner)).phase,'prepared');
  await runPostgresMigrations({connectionString,log:()=>{}});
  await repo.deleteOwnerData(owner);assert.equal((await fresh.status(owner)).phase,'unlinked');
 }finally{await repo.deleteOwnerData(owner);await pool.end();}
});

test('staged and active records survive reconnect and retries, retain private history, become readonly and delete in isolation',async()=>{
 await runPostgresMigrations({connectionString,log:()=>{}});
 const configuration={sourceInstance:'grow-test',secret:'record-transfer-pg-lifecycle-secret-at-least-32-bytes'};
 const owner={appId:'lighttick' as const,userId:'record-transfer-pg-lifecycle-alice'};
 const other={...owner,userId:'record-transfer-pg-lifecycle-bob'};
 const source={instance:configuration.sourceInstance,subject:'legacy-pg-lifecycle-alice'};
 const operationId='record-transfer-pg-lifecycle-operation';
 const sourceId='ref-'+'c'.repeat(32);
 const privateMarker='synthetic-pg-private-history-alice-only';
 const first:LightTickRecord={id:sourceId,raw_text:'持久化导入第一版',record_date:'2026-10-19',prompt_kind:'free',guided_answers:{},tags:['迁移'],version:1,
  created_at:'2026-10-19T01:00:00.000Z',updated_at:'2026-10-19T01:00:00.000Z'};
 const current:LightTickRecord={...first,raw_text:'持久化导入第二版',version:2,updated_at:'2026-10-20T01:00:00.000Z'};
 const snapshot:RecordPackage={format_version:1,source_instance:source.instance,source_subject:source.subject,operation_id:operationId,
  entries:[{source_id:sourceId,record:structuredClone(current),versions:[structuredClone(first),structuredClone(current)],
   private_history:{entry:{source_id:sourceId},versions:[{version:1,raw_text:first.raw_text},{version:2,raw_text:current.raw_text}],
    attempts:[{id:'pg-private-attempt-001',content:privateMarker}]}}]};
 const snapshotHash=digest(snapshot);
 let pool=new Pool({connectionString});
 let repo=new PostgresLightTickRepository(pool);
 let service=new RecordTransferService(repo,configuration);
 let records=new LightTickRecordService(repo);
 async function reconnect(){
  await pool.end();pool=new Pool({connectionString});repo=new PostgresLightTickRepository(pool);
  service=new RecordTransferService(repo,configuration);records=new LightTickRecordService(repo);
 }
 const body=(raw_text:string,base_version:number)=>({raw_text,record_date:'2026-10-25',prompt_kind:'free',guided_answers:{},tags:[],base_version});
 try {
  await repo.deleteOwnerData(owner);await repo.deleteOwnerData(other);
  const ticket=await service.ticket(owner);
  const binding=await service.claim(source,{code:ticket.code,operation_id:operationId});
  const stage={binding_id:binding.binding_id,operation_id:operationId,snapshot,snapshot_hash:snapshotHash};
  await service.stage(source,stage);
  assert.equal((await records.list(owner,{archived:'all'})).items.length,0);
  assert.equal((await records.export(owner)).records.length,0);
  assert.equal((await repo.pullChanges(owner,0,200)).length,0);

  await reconnect();
  assert.equal((await service.status(owner)).phase,'staged');
  assert.equal((await service.stage(source,stage)).snapshot_hash,snapshotHash);
  assert.equal((await records.export(owner)).records.length,0,'A stage retry after reconnect must remain private');
  const freeze={scope:'records',phase:'frozen',binding_id:binding.binding_id,operation_id:operationId,snapshot_hash:snapshotHash,
   source_instance:source.instance,source_subject:source.subject};
  const activation={binding_id:binding.binding_id,operation_id:operationId,snapshot_hash:snapshotHash,
   freeze_receipt:{...freeze,signature:createHmac('sha256',configuration.secret).update(canonical(freeze)).digest('hex')}};
  const receipt=await service.activate(source,activation);
  const imported=(await records.list(owner,{archived:'all'})).items;
  assert.equal(imported.length,1);assert.equal(imported[0].version,2);assert.equal(imported[0].raw_text,current.raw_text);
  const importedId=imported[0].id;
  const history=(await records.versions(owner,importedId)).items;
  assert.deepEqual(history.map(value=>value.version).sort((a,b)=>a-b),[1,2]);
  assert.deepEqual(history.map(value=>value.raw_text).sort(),[first.raw_text,current.raw_text].sort());
  const exported=await records.export(owner);
  assert.deepEqual(exported.records[0].source_history?.private_history,snapshot.entries[0].private_history);
  const changes=await repo.pullChanges(owner,0,200);assert.equal(changes.length,1);

  const proofBody={action:'status'},nonce='record-proof-pg-lifecycle-restart-001',timestamp=String(Math.floor(Date.now()/1000));
  const proofHeaders={'x-grow-timestamp':timestamp,'x-grow-nonce':nonce,
   'x-grow-signature':createHmac('sha256',configuration.secret).update([source.instance,source.subject,timestamp,nonce,canonical(proofBody)].join('\n')).digest('hex')};
  assert.equal((await service.bridge(source,proofHeaders,proofBody)).phase,'active');
  await reconnect();
  assert.equal((await service.status(owner)).phase,'active');
  for(let index=0;index<2;index++) assert.deepEqual(await service.activate(source,activation),receipt);
  assert.deepEqual((await records.list(owner,{archived:'all'})).items,imported);
  assert.deepEqual((await records.versions(owner,importedId)).items,history);
  assert.deepEqual((await repo.pullChanges(owner,0,200)).filter(value=>value.entityType==='record'),changes);
  assert.deepEqual((await records.export(owner)).records,exported.records);
  await assert.rejects(service.bridge(source,proofHeaders,proofBody),(error:any)=>error.statusCode===403,'Consumed bridge nonces must survive reconnect');

  await records.mutate(owner,importedId,'save',body('接管后第三版原文',2),'record-pg-lifecycle-edit-001');
  await records.mutate(owner,'record-pg-lifecycle-native','save',body('接管后新增原文',0),'record-pg-lifecycle-create-001');
  await records.mutate(owner,'record-pg-lifecycle-native','archive',{base_version:1},'record-pg-lifecycle-native-archive');
  await records.mutate(other,'record-pg-lifecycle-bob','save',body('其他账户原文',0),'record-pg-lifecycle-bob-001');
  const readonly=await service.setReadonly(owner);
  assert.equal(readonly.phase,'readonly');assert.equal(readonly.export.records.length,2);
  const newest=readonly.export.records.find(value=>value.record.id===importedId)!;
  assert.equal(newest.record.raw_text,'接管后第三版原文');assert.equal(newest.record.version,3);assert.equal(newest.versions.length,3);
  assert.deepEqual(newest.source_history?.private_history,snapshot.entries[0].private_history);
  assert.ok(readonly.export.records.some(value=>value.record.raw_text==='接管后新增原文'));
  const archived=readonly.export.records.find(value=>value.record.id==='record-pg-lifecycle-native')!;
  assert.ok(archived.record.archived_at);assert.equal(archived.versions.length,2);
  await reconnect();
  assert.equal((await service.status(owner)).phase,'readonly');
  await assert.rejects(records.mutate(owner,importedId,'save',body('不允许覆盖',3),'record-pg-lifecycle-forbidden-edit'),(error:any)=>error.statusCode===423);
  await assert.rejects(records.mutate(owner,'record-pg-lifecycle-forbidden','save',body('不允许新增',0),'record-pg-lifecycle-forbidden-create'),(error:any)=>error.statusCode===423);
  await assert.rejects(records.mutate(owner,importedId,'archive',{base_version:3},'record-pg-lifecycle-forbidden-archive'),(error:any)=>error.statusCode===423);
  assert.deepEqual((await records.export(owner)).records,readonly.export.records);
  const privateExport=JSON.stringify(await records.export(other));assert.ok(!privateExport.includes(privateMarker));assert.ok(!privateExport.includes(sourceId));
  await runPostgresMigrations({connectionString,log:()=>{}});

  await repo.deleteOwnerData(owner);
  assert.equal((await service.status(owner)).phase,'unlinked');
  assert.equal((await records.export(owner)).records.length,0);
  assert.equal((await repo.recordVersions(owner,importedId)).length,0);
  assert.equal(await repo.recordSourceHistory(owner,importedId),undefined);
  assert.equal(await repo.getRecordTransferTicket(digest(ticket.code)),undefined);
  assert.equal((await repo.pullChanges(owner,0,200)).length,0);
  await assert.rejects(service.activate(source,activation),(error:any)=>error.statusCode===404);
  await assert.rejects(service.claim(source,{code:ticket.code,operation_id:operationId}),(error:any)=>error.statusCode===409);
  assert.equal((await records.get(other,'record-pg-lifecycle-bob')).raw_text,'其他账户原文');
  await reconnect();
  assert.equal((await service.status(owner)).phase,'unlinked');assert.equal((await records.export(owner)).records.length,0);
  assert.equal((await records.export(other)).records.length,1);
 } finally {
  await repo.deleteOwnerData(owner);await repo.deleteOwnerData(other);await pool.end();
 }
});
