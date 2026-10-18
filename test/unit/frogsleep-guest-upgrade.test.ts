import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import test from 'node:test';
import { createApplication } from '../../src/app.module.ts';
import { InMemoryDatabase } from '../../src/testing/in-memory-database.ts';
import { SleepGuestService } from '../../src/modules/frogsleep/guest/sleep-guest.service.ts';
import { PersonalSyncService } from '../../src/modules/frogsleep/personal-sync/personal-sync.service.ts';
async function fixture() {
  const runtime=await createApplication({frogsleepEnabled:true,queueBackend:'memory',databaseFactory:s=>new InMemoryDatabase(s)});
  const login=await runtime.services.authService.login({appId:'frogsleep',account:'alice@example.com',password:'Password1234'});
  const db=runtime.database,guest=new SleepGuestService(db,runtime.services.appRegistryService),sync=new PersonalSyncService(db.getPersonalSyncRepository());
  const epoch=(await sync.state('user_alice')).sync_epoch;
  const call=(method:string,path:string,body?:unknown,token=login.accessToken,headers:Record<string,string>={})=>runtime.app.handle({method,path,body,headers:{...(token?{authorization:`Bearer ${token}`} : {}),...headers}} as never);
  const body={device_id:'test-device-'+randomBytes(6).toString('hex'),device_secret:randomBytes(32).toString('base64url'),platform:'ios'};
  return {runtime,db,guest,sync,epoch,call,body};
}
test('guest creation recovers identity with exact proof, rejects key misuse and expiry',async()=>{
  const {guest,db,body}=await fixture();const now=new Date('2026-10-18T00:00:00Z');
  const first=await guest.create(body,'create',now),replay=await guest.create(body,'create',now),recovered=await guest.create(body,'recover',now);
  assert.deepEqual(first,replay);assert.deepEqual(first,recovered);
  assert.ok(!JSON.stringify(await db.getSleepGuestStore().find(first.guest_user_id)).includes(body.device_secret));
  assert.ok(!JSON.stringify(await db.getSleepGuestStore().find(first.guest_user_id)).includes(first.guest_upgrade_token));
  await assert.rejects(guest.create({...body,platform:'android'},'create',now),{code:'FROGSLEEP_GUEST_IDEMPOTENCY_CONFLICT'});
  const other=await guest.create({...body,device_secret:randomBytes(32).toString('base64url')},'other',now);assert.notEqual(first.guest_user_id,other.guest_user_id);
  await assert.rejects(guest.create(body,'expired',new Date('2026-11-20')),{code:'FROGSLEEP_GUEST_PROOF_INVALID'});
});
test('upgrade migrates latest data and tombstones once, deduplicates and revokes source',async()=>{
  const {guest,db,sync,body,epoch}=await fixture();const g=await guest.create(body,'create');
  await sync.write(g.guest_user_id,'sleep_session','raw',{minutes:400},false);
  await sync.write(g.guest_user_id,'sleep_report','same',{minutes:400},false);
  await sync.write('user_alice','sleep_report','same',{minutes:400},false);
  await sync.write(g.guest_user_id,'sleep_session','removed',{minutes:1},false);
  await sync.write(g.guest_user_id,'sleep_session','removed',{},true,{expectedRevision:1});
  const request={guest_user_id:g.guest_user_id,guest_upgrade_token:g.guest_upgrade_token,device_id:body.device_id,confirmed:true};
  const results=await Promise.all(Array.from({length:8},()=>guest.upgrade('user_alice',request,'upgrade',epoch)));
  assert.ok(results.every(r=>JSON.stringify(r)===JSON.stringify(results[0])));assert.equal(results[0].migrated_data_count,2);assert.equal(results[0].deduplicated_data_count,1);
  const page=await sync.page('user_alice','restore',100);assert.equal(page.items.length,3);assert.equal(page.items.find(i=>i.id==='removed')?.deleted,true);
  assert.equal((await db.findAppUser('frogsleep',g.guest_user_id))?.status,'DELETED');
  await assert.rejects(guest.create(body,'recover'),{code:'FROGSLEEP_GUEST_PROOF_INVALID'});
  await assert.rejects(guest.upgrade('user_alice',request,'other-key',epoch),{code:'FROGSLEEP_GUEST_ALREADY_UPGRADED'});
  await assert.rejects(guest.upgrade('user_alice',{...request,guest_upgrade_token:'x'.repeat(48)},'upgrade',epoch),{code:'FROGSLEEP_GUEST_PROOF_INVALID'});
});
test('collisions and persistence failures roll back target history, source identity and receipts',async()=>{
  const {guest,db,sync,body,epoch}=await fixture(),g=await guest.create(body,'create');
  await sync.write(g.guest_user_id,'sleep_session','new',{minutes:2},false);
  await sync.write(g.guest_user_id,'sleep_session','conflict',{minutes:3},false);
  await sync.write('user_alice','sleep_session','conflict',{minutes:4},false);
  const request={guest_user_id:g.guest_user_id,guest_upgrade_token:g.guest_upgrade_token,device_id:body.device_id,confirmed:true},before=await sync.state('user_alice');
  await assert.rejects(guest.upgrade('user_alice',request,'upgrade',epoch),{code:'FROGSLEEP_GUEST_DATA_CONFLICT'});
  assert.equal((await sync.state('user_alice')).sequence,before.sequence);assert.equal((await sync.page(g.guest_user_id,'restore',100)).items.length,2);assert.equal(await db.getSleepGuestStore().upgrade(g.guest_user_id),undefined);
  await sync.write('user_alice','sleep_session','conflict',{minutes:3},false,{expectedRevision:1});
  const store=db.getSleepGuestStore(),save=store.saveUpgrade;store.saveUpgrade=async()=>{throw new Error('injected persistence failure');};
  try {await assert.rejects(guest.upgrade('user_alice',request,'upgrade',epoch),/injected/);}finally{store.saveUpgrade=save;}
  assert.equal((await db.findAppUser('frogsleep',g.guest_user_id))?.status,'ACTIVE');assert.equal((await sync.state('user_alice')).sequence,before.sequence+1);assert.equal((await sync.page(g.guest_user_id,'restore',100)).items.length,2);
  assert.equal((await guest.upgrade('user_alice',request,'upgrade',epoch)).migrated_data_count,1);
});
test('guest bearer is confined to private sync and cannot upgrade to itself or use platform APIs',async()=>{
  const {runtime,call,body,epoch}=await fixture();
  const created=await call('POST','/api/v1/frogsleep/account/guest-sessions',body,'',{'idempotency-key':'create'});assert.equal(created.statusCode,200);
  const g=created.body.data,token=g.access_token;
  assert.equal((await call('GET','/api/v1/frogsleep/product-data/personal-sync/state',undefined,token)).statusCode,200);
  for(const [method,path] of [['GET','/api/v1/frogsleep/focus/sessions'],['GET','/api/v1/users/me'],['POST','/api/v1/frogsleep/me/devices'],['POST','/api/v1/frogsleep/account/upgrade']]) assert.equal((await call(method,path,{},token)).statusCode,403,path);
  const request={guest_user_id:g.guest_user_id,guest_upgrade_token:g.guest_upgrade_token,device_id:body.device_id,confirmed:true};
  assert.equal((await call('POST','/api/v1/frogsleep/account/upgrade',{...request,device_id:'wrong'},undefined,{'idempotency-key':'upgrade','x-sync-epoch':epoch})).statusCode,401);
  assert.equal((await call('POST','/api/v1/frogsleep/account/upgrade',request,undefined,{'idempotency-key':'upgrade','x-sync-epoch':epoch})).statusCode,200);
  assert.equal((await call('GET','/api/v1/frogsleep/me',undefined,token)).statusCode,401);
  await assert.rejects(runtime.services.authService.refresh({appId:'frogsleep',refreshToken:g.refresh_token}));
  assert.equal((await call('POST','/api/v1/frogsleep/account/upgrade',request,undefined,{'idempotency-key':'upgrade','x-sync-epoch':epoch})).statusCode,200);
});
test('blocked guests, stale target epochs, missing consent and guest targets cannot transfer',async()=>{
  const {guest,db,sync,body,epoch}=await fixture(),g=await guest.create(body,'create');
  await sync.write(g.guest_user_id,'sleep_session','blocked',{},false);
  const request={guest_user_id:g.guest_user_id,guest_upgrade_token:g.guest_upgrade_token,device_id:body.device_id,confirmed:true};
  await assert.rejects(guest.upgrade('user_alice',{...request,confirmed:false},'upgrade',epoch),{code:'REQ_INVALID_BODY'});
  await assert.rejects(guest.upgrade('user_alice',request,'upgrade','stale'),{code:'FROGSLEEP_SYNC_EPOCH_MISMATCH'});
  await assert.rejects(guest.upgrade(g.guest_user_id,request,'upgrade',epoch),{code:'FROGSLEEP_REGISTERED_ACCOUNT_REQUIRED'});
  const user=(db as InMemoryDatabase).users.find(u=>u.id===g.guest_user_id)!;user.status='BLOCKED';
  await assert.rejects(guest.upgrade('user_alice',request,'upgrade',epoch),{code:'FROGSLEEP_GUEST_PROOF_INVALID'});
  assert.equal((await sync.state('user_alice')).sequence,0);assert.equal(await db.getSleepGuestStore().upgrade(g.guest_user_id),undefined);
  assert.equal((await sync.page(g.guest_user_id,'restore',100)).items.length,1);
});
test('committed upgrade survives KV revocation failure and exact retry finishes cleanup',async()=>{
  const {runtime,call,body,epoch,db}=await fixture();
  const response=await call('POST','/api/v1/frogsleep/account/guest-sessions',body,'',{'idempotency-key':'create'}),g=response.body.data;
  const request={guest_user_id:g.guest_user_id,guest_upgrade_token:g.guest_upgrade_token,device_id:body.device_id,confirmed:true},headers={'idempotency-key':'upgrade','x-sync-epoch':epoch};
  const revoke=runtime.services.authService.revokeAllSessions;
  runtime.services.authService.revokeAllSessions=async()=>{throw new Error('KV unavailable');};
  try {assert.equal((await call('POST','/api/v1/frogsleep/account/upgrade',request,undefined,headers)).statusCode,500);}finally{runtime.services.authService.revokeAllSessions=revoke;}
  assert.equal((await db.findAppUser('frogsleep',g.guest_user_id))?.status,'DELETED');
  assert.equal((await call('GET','/api/v1/frogsleep/me',undefined,g.access_token)).statusCode,401);
  assert.equal((await call('POST','/api/v1/frogsleep/account/upgrade',request,undefined,headers)).statusCode,200);
});
test('guest identity expiry blocks access/refresh and anonymous issuance is rate limited',async()=>{
  const {runtime,call,body,guest}=await fixture();
  const old=await guest.create(body,'old',new Date(Date.now()-31*86400000)),session=await runtime.services.authService.issueSession(old.guest_user_id,'frogsleep');
  assert.equal((await call('GET','/api/v1/frogsleep/me',undefined,session.accessToken)).statusCode,401);
  await assert.rejects(runtime.services.authService.refresh({appId:'frogsleep',refreshToken:session.refreshToken}),{code:'FROGSLEEP_GUEST_SESSION_INVALID'});
  assert.equal((await call('POST','/api/v1/frogsleep/account/guest-sessions',body,'',{'idempotency-key':'x','x-app-id':'app_a'})).statusCode,403);
  const proof={...body,device_secret:randomBytes(32).toString('base64url')};
  for(let i=0;i<30;i++)assert.equal((await call('POST','/api/v1/frogsleep/account/guest-sessions',proof,'',{'idempotency-key':'rate-replay'})).statusCode,200);
  assert.equal((await call('POST','/api/v1/frogsleep/account/guest-sessions',proof,'',{'idempotency-key':'rate-replay'})).statusCode,429);
});
