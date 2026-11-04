import assert from 'node:assert/strict';
import test from 'node:test';
import { createApplication } from '../../src/app.module.ts';
import { InMemoryDatabase } from '../../src/testing/in-memory-database.ts';
export const rawSession = { session_id:'night-1',schema_version:'1',status:'completed',started_at:'2026-10-17T22:00:00+08:00',ended_at:'2026-10-18T06:00:00+08:00',sleep_intent:'night_sleep',timezone:'Asia/Shanghai',data:{break_count:1,ritual_mode:'locking'},events:[{event_id:'e1',type:'paused',occurred_at:'2026-10-17T23:00:00+08:00',data:{reason:'water'}}] };
test('raw sleep API stores terminal data, revisions, restore and tombstones privately', async()=>{
  const runtime=await createApplication({frogsleepEnabled:true,queueBackend:'memory',databaseFactory:s=>new InMemoryDatabase(s)});
  const login=await runtime.services.authService.login({appId:'frogsleep',account:'alice@example.com',password:'Password1234'});
  const call=(method:string,path:string,body?:unknown,headers:Record<string,string>={})=>runtime.app.handle({method,path:'/api/v1/frogsleep/product-data'+path,body,headers:{authorization:`Bearer ${login.accessToken}`,...headers}} as never);
  const state=await call('GET','/personal-sync/state'); const h={'x-sync-epoch':state.body.data.sync_epoch,'idempotency-key':'raw-create'};
  assert.equal((await call('POST','/sleep-sessions',rawSession)).statusCode,400);
  const first=await call('POST','/sleep-sessions',rawSession,h);assert.equal(first.statusCode,200); assert.equal(first.body.data.sleep_session.kind,'sleep_session');assert.equal(first.body.data.sleep_session.data.started_at,'2026-10-17T14:00:00.000Z');
  assert.deepEqual((await call('POST','/sleep-sessions',rawSession,h)).body.data,first.body.data);
  assert.equal((await call('POST','/sleep-sessions',{...rawSession,owner_user_id:'user_bob'},h)).statusCode,403);
  assert.equal((await call('PUT','/sleep-sessions/night-1',{...rawSession,data:{break_count:2}},{...h,'idempotency-key':'update'})).statusCode,409);
  assert.equal((await call('PUT','/sleep-sessions/night-1',{...rawSession,data:{break_count:2}},{...h,'idempotency-key':'update','if-match':'1'})).statusCode,200);
  assert.equal((await call('GET','/sleep-sessions')).body.data.items.length,1);
  assert.equal((await call('GET','/personal-sync/restore')).body.data.items[0].kind,'sleep_session');
  assert.equal((await call('DELETE','/sleep-sessions/night-1',undefined,{...h,'idempotency-key':'delete','if-match':'2'})).statusCode,200);
  assert.equal((await call('GET','/sleep-sessions/night-1')).statusCode,404);
  assert.equal((await call('GET','/sleep-sessions')).body.data.items[0].deleted,true);
  assert.equal((await call('POST','/sleep-sessions',rawSession,{...h,'idempotency-key':'revive'})).statusCode,410);
  for(const invalid of [{...rawSession,status:['completed']},{...rawSession,sleep_intent:['night_sleep']},{...rawSession,status:'active'},{...rawSession,ended_at:'2020-01-01T00:00:00Z'},{...rawSession,started_at:'yesterday'},{...rawSession,events:[rawSession.events[0],rawSession.events[0]]},{...rawSession,data:{large:'x'.repeat(131073)}},{...rawSession,data:{bad:Infinity}},{...rawSession,data:Array.from({length:40}).reduce(acc=>({nested:acc}),{})}]) assert.equal((await call('POST','/sleep-sessions',invalid,{...h,'idempotency-key':'invalid'})).statusCode,400);
});
test('raw timestamps accept RFC3339 fractional precision and normalize to milliseconds',async()=>{
  const {rawSleepSession}=await import('../../src/modules/frogsleep/personal-sync/raw-sleep-session.ts');
  const result=rawSleepSession({...rawSession,started_at:'2026-10-17t14:00:00.123456z'});
  assert.equal(result.started_at,'2026-10-17T14:00:00.123Z');
});
