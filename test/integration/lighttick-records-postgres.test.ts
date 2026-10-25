import assert from 'node:assert/strict';
import test from 'node:test';
import {Pool} from 'pg';
import {PostgresLightTickRepository} from '../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts';
import {runPostgresMigrations} from '../../src/infrastructure/database/postgres/migrate.ts';
import {LightTickRecordService} from '../../src/modules/lighttick/lighttick-record.service.ts';
const connectionString=process.env.LIGHTTICK_TEST_DATABASE_URL;
if(!connectionString) throw new Error('Disposable LIGHTTICK_TEST_DATABASE_URL required');
test('records persist with atomic history, idempotency, change log, reconnect, CAS, rollback and deletion isolation',async()=>{
 await runPostgresMigrations({connectionString,log:()=>{}});
 const pool=new Pool({connectionString});const repo=new PostgresLightTickRepository(pool);const service=new LightTickRecordService(repo);
 const owner={appId:'lighttick' as const,userId:'records-pg-alice'},other={...owner,userId:'records-pg-bob'};
 const body={raw_text:'原文',record_date:'2026-10-19',base_version:0};
 try{
 await service.mutate(owner,'record-pg-001','save',body,'record-pg-key-001');
 await service.mutate(other,'record-pg-001','save',body,'record-pg-key-001');
 const reconnect=new LightTickRecordService(new PostgresLightTickRepository(pool));
 assert.equal((await reconnect.get(owner,'record-pg-001')).raw_text,'原文');
 const replay=await Promise.all([1,2].map(()=>reconnect.mutate(owner,'record-pg-001','save',body,'record-pg-key-001'))); assert.equal(replay[1].version,1);
 const attempts=await Promise.allSettled(['A','B'].map(raw_text=>reconnect.mutate(owner,'record-pg-001','save',{...body,raw_text,base_version:1},'record-pg-change-'+raw_text)));
 assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);
 await assert.rejects(repo.transaction(owner,async()=>{await service.mutate(owner,'record-pg-002','save',body,'record-pg-rollback');throw new Error('rollback');}));
 await assert.rejects(reconnect.get(owner,'record-pg-002'));
 assert.equal((await repo.pullChanges(owner,0,100)).length,2);
 assert.equal((await service.export(owner)).records[0].versions.length,2);
 await runPostgresMigrations({connectionString,log:()=>{}});
 for(const id of ['record-page-A','record-page-a','record-page-b']) await service.mutate(owner,id,'save',{...body,tags:['分页标签']},'page-'+id);
 const page=await service.list(owner,{q:'分页标签',limit:'1'});assert.equal(page.has_more,true);
 const next=await service.list(owner,{q:'分页标签',limit:'1',cursor:page.next_cursor});assert.notEqual(page.items[0].id,next.items[0].id);
 await repo.deleteOwnerData(owner);
 assert.equal((await service.export(owner)).records.length,0);
 assert.equal((await repo.pullChanges(owner,0,100)).length,0);
 assert.equal((await repo.recordVersions(owner,'record-pg-001')).length,0);
 assert.equal((await service.get(other,'record-pg-001')).version,1);
 }finally{await repo.deleteOwnerData(owner);await repo.deleteOwnerData(other);await pool.end();}
});
