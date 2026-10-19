import assert from 'node:assert/strict';
import test from 'node:test';
import {LightTickRecordService} from '../../src/modules/lighttick/lighttick-record.service.ts';
import {InMemoryLightTickRepository} from '../../src/testing/in-memory-lighttick-repository.ts';
import {buildDefaultSeed} from '../../src/infrastructure/database/prisma/default-seed.ts';
import {createApplication} from '../support/create-test-application.ts';
test('record pagination binds filters and owner; deletion and rollback leave no history or change',async()=>{
 const repo=new InMemoryLightTickRepository(),s=new LightTickRecordService(repo),owner={appId:'lighttick' as const,userId:'alice'},other={...owner,userId:'bob'};
 const body={raw_text:'原文',record_date:'2026-10-19',base_version:0};
 for(const id of ['record-test-A','record-test-a','record-test-b']) await s.mutate(owner,id,'save',body,'key-'+id);
 const first=await s.list(owner,{limit:'1'});const second=await s.list(owner,{limit:'1',cursor:first.next_cursor});
 assert.notEqual(first.items[0].id,second.items[0].id);
 await assert.rejects(s.list(other,{cursor:first.next_cursor}));await assert.rejects(s.list(owner,{q:'x',cursor:first.next_cursor}));
 await assert.rejects(repo.transaction(owner,async()=>{await s.mutate(owner,'record-test-rollback','save',body,'record-rollback-key');throw new Error('fail');}));
 assert.equal((await repo.pullChanges(owner,0,100)).length,3);
 await s.mutate(other,'record-other-001','save',body,'record-other-key');await repo.deleteOwnerData(owner);
 assert.equal((await s.export(owner)).records.length,0);assert.equal((await repo.recordVersions(owner,'record-test-A')).length,0);
 assert.equal((await s.get(other,'record-other-001')).raw_text,'原文');
});
test('guest cloud access is denied while no record or AI is created',async()=>{
 const app=await createApplication({seed:buildDefaultSeed(undefined,{includeLightTick:true}),lighttickEnabled:true});
 const guest=await app.app.handle({method:'POST',path:'/api/v1/lighttick/account/guest-sessions',headers:{'x-app-id':'lighttick','idempotency-key':'record-guest-key'},body:{device_id:'record-guest-device',device_secret:'record-guest-secret-12345678901234567890',platform:'ios',timezone:'Asia/Shanghai',locale:'zh-CN',app_version:'0.1.0'}});
 assert.equal(guest.statusCode,201,JSON.stringify(guest.body));
 const r=await app.app.handle({method:'GET',path:'/api/v1/lighttick/records',headers:{'x-app-id':'lighttick',authorization:'Bearer '+guest.body.data.access_token}});assert.equal(r.statusCode,403);
});
