import assert from 'node:assert/strict';
import test from 'node:test';
import { randomBytes } from 'node:crypto';
import { Client } from 'pg';
import { createApplication } from '../../src/app.module.ts';
import { PostgresDatabase } from '../../src/infrastructure/database/postgres/postgres-database.ts';
import { buildDefaultSeed } from '../../src/infrastructure/database/prisma/default-seed.ts';
import { SleepGuestService } from '../../src/modules/frogsleep/guest/sleep-guest.service.ts';
import { PersonalSyncService } from '../../src/modules/frogsleep/personal-sync/personal-sync.service.ts';
const url=process.env.FROGSLEEP_TEST_DATABASE_URL;
if(!url)throw new Error('FROGSLEEP_TEST_DATABASE_URL must point to a disposable database.');
test('PostgreSQL raw sleep sync and proof-based guest upgrades are atomic across connections',async suite=>{
  const runtime=await createApplication({frogsleepEnabled:true,queueBackend:'memory',databaseFactory:s=>PostgresDatabase.create(url,s)}),a=runtime.database;
  const b=await PostgresDatabase.create(url,buildDefaultSeed(undefined,{includeFrogSleep:true})),sql=new Client({connectionString:url});await sql.connect();
  const sa=new PersonalSyncService(a.getPersonalSyncRepository()),sb=new PersonalSyncService(b.getPersonalSyncRepository());
  const ga=new SleepGuestService(a,runtime.services.appRegistryService),gb=new SleepGuestService(b,runtime.services.appRegistryService);
  const fresh=async()=>{
    const body={device_id:'pg-'+randomBytes(8).toString('hex'),device_secret:randomBytes(32).toString('base64url'),platform:'ios'};
    const identity=await ga.create(body,'create-'+body.device_id);
    return {body,identity,request:{guest_user_id:identity.guest_user_id,guest_upgrade_token:identity.guest_upgrade_token,device_id:body.device_id,confirmed:true}};
  };
  try {
    await runtime.services.authService.login({appId:'frogsleep',account:'alice@example.com',password:'Password1234'});
    const epoch=(await sa.state('user_alice')).sync_epoch;
    await suite.test('raw kind persists, pages above 500 and keeps changes after fixed restore boundary',async()=>{
      for(let i=0;i<505;i++)await sa.write('user_alice','sleep_session','raw-'+i,{session_id:'raw-'+i},false,{epoch,operationKey:'raw-'+i});
      let page=await sa.page('user_alice','restore',100,undefined,'sleep_session'),rows=[...page.items],checkpoint=page.changes_cursor;
      await sb.write('user_alice','sleep_session','after-boundary',{},false,{epoch});
      while(page.pagination.has_more){page=await sb.page('user_alice','restore',100,page.pagination.next_cursor!,'sleep_session');rows.push(...page.items);checkpoint=page.changes_cursor;}
      assert.equal(rows.length,505);assert.equal(new Set(rows.map(r=>r.id)).size,505);
      assert.ok((await sa.page('user_alice','changes',100,checkpoint)).items.some(r=>r.id==='after-boundary'));
    });
    await suite.test('simultaneous upgrades replay exactly once, carry tombstones and revoke source membership',async()=>{
      const {identity,request,body}=await fresh();
      await sa.write(identity.guest_user_id,'sleep_session','guest-raw',{},false);
      await sa.write(identity.guest_user_id,'sleep_session','guest-tombstone',{},false);
      await sa.write(identity.guest_user_id,'sleep_session','guest-tombstone',{},true,{expectedRevision:1});
      const results=await Promise.all(Array.from({length:10},(_,i)=>(i%2?ga:gb).upgrade('user_alice',request,'upgrade-one',epoch)));
      for(const result of results)assert.deepEqual(result,results[0]);assert.equal(results[0].migrated_data_count,2);
      assert.equal((await b.findAppUser('frogsleep',identity.guest_user_id))?.status,'DELETED');
      assert.equal((await sql.query('SELECT count(*)::int n FROM zook_frogsleep_personal_versions WHERE user_id=$1',[identity.guest_user_id])).rows[0].n,0);
      assert.equal((await sql.query('SELECT count(*)::int n FROM zook_frogsleep_guest_upgrades WHERE guest_user_id=$1',[identity.guest_user_id])).rows[0].n,1);
      await assert.rejects(ga.create(body,'recover'),{code:'FROGSLEEP_GUEST_PROOF_INVALID'});
    });
    await suite.test('collision after an earlier inserted row rolls everything back',async()=>{
      const {identity,request}=await fresh();
      await sa.write(identity.guest_user_id,'sleep_session','partial-before-conflict',{v:1},false);
      await sa.write(identity.guest_user_id,'sleep_session','collision',{v:2},false);
      await sa.write('user_alice','sleep_session','collision',{v:3},false);
      const before=await sa.state('user_alice');
      await assert.rejects(gb.upgrade('user_alice',request,'collision',epoch),{code:'FROGSLEEP_GUEST_DATA_CONFLICT'});
      assert.equal((await sa.state('user_alice')).sequence,before.sequence);
      await assert.rejects(sb.get('user_alice','sleep_session','partial-before-conflict'),{code:'FROGSLEEP_SYNC_RESOURCE_NOT_FOUND'});
      assert.equal((await sb.page(identity.guest_user_id,'restore',100)).items.length,2);assert.equal(await b.getSleepGuestStore().upgrade(identity.guest_user_id),undefined);
    });
    await suite.test('late persistence failure restores source epoch and target contents',async()=>{
      const {identity,request}=await fresh();await sa.write(identity.guest_user_id,'report_preferences','report_preferences',{v:1},false);
      const before=await sa.state('user_alice'),source=await sa.state(identity.guest_user_id),store=a.getSleepGuestStore(),get=a.getSleepGuestStore;
      store.saveUpgrade=async()=>{throw new Error('injected SQL receipt failure');};a.getSleepGuestStore=()=>store;
      try {await assert.rejects(ga.upgrade('user_alice',request,'failure',epoch),/injected SQL/);}finally{a.getSleepGuestStore=get;}
      assert.deepEqual(await sb.state(identity.guest_user_id),source);assert.deepEqual(await sb.state('user_alice'),before);
      assert.equal((await b.findAppUser('frogsleep',identity.guest_user_id))?.status,'ACTIVE');
    });
    await suite.test('source upload racing transfer is either included or rejected, never stranded',async()=>{
      const {identity,request}=await fresh();
      const results=await Promise.allSettled([sb.write(identity.guest_user_id,'sleep_session','racing-raw',{},false),ga.upgrade('user_alice',request,'racing',epoch)]);
      assert.equal(results[1].status,'fulfilled');
      if(results[0].status==='fulfilled')assert.equal((await sa.get('user_alice','sleep_session','racing-raw')).id,'racing-raw');
      else assert.equal((results[0].reason as {code:string}).code,'APP_MEMBERSHIP_REQUIRED');
      assert.equal((await sql.query('SELECT count(*)::int n FROM zook_frogsleep_personal_versions WHERE user_id=$1',[identity.guest_user_id])).rows[0].n,0);
    });
    await suite.test('creation proof and operation retries serialize across requests',async()=>{
      const body={device_id:'concurrent-create',device_secret:randomBytes(32).toString('base64url'),platform:'android'};
      const created=await Promise.all(Array.from({length:8},()=>ga.create(body,'same-create-command')));
      for(const guest of created)assert.deepEqual(guest,created[0]);
      await assert.rejects(ga.create({...body,device_secret:randomBytes(32).toString('base64url')},'same-create-command'),{code:'FROGSLEEP_GUEST_IDEMPOTENCY_CONFLICT'});
      assert.equal((await sql.query('SELECT count(*)::int n FROM zook_frogsleep_guest_identities WHERE user_id=$1',[created[0].guest_user_id])).rows[0].n,1);
    });
    await suite.test('source deletion racing upgrade never revives or strands private resources',async()=>{
      const {identity,request}=await fresh();await sa.write(identity.guest_user_id,'sleep_session','delete-race',{},false);
      const results=await Promise.allSettled([
        gb.upgrade('user_alice',request,'delete-race',epoch),
        a.withAppUserDataTransaction('frogsleep',identity.guest_user_id,async()=>{
          await a.deleteAppUserRuntimeData('frogsleep',identity.guest_user_id);
          await a.updateAppUserStatus('frogsleep',identity.guest_user_id,'DELETED');
        }),
      ]);
      assert.equal(results[1].status,'fulfilled');
      if(results[0].status==='fulfilled') assert.equal((await sb.get('user_alice','sleep_session','delete-race')).id,'delete-race');
      else {assert.equal(results[0].reason.code,'FROGSLEEP_GUEST_PROOF_INVALID');await assert.rejects(sb.get('user_alice','sleep_session','delete-race'),{code:'FROGSLEEP_SYNC_RESOURCE_NOT_FOUND'});}
      assert.equal((await sql.query('SELECT count(*)::int n FROM zook_frogsleep_personal_versions WHERE user_id=$1',[identity.guest_user_id])).rows[0].n,0);
    });
    await suite.test('blocked source fails before transfer and keeps both histories intact',async()=>{
      const {identity,request}=await fresh();await sa.write(identity.guest_user_id,'sleep_session','blocked-source',{},false);
      await sql.query("UPDATE zook_users SET status='BLOCKED' WHERE id=$1",[identity.guest_user_id]);
      const before=await sa.state('user_alice');
      await assert.rejects(gb.upgrade('user_alice',request,'blocked',epoch),{code:'FROGSLEEP_GUEST_PROOF_INVALID'});
      assert.deepEqual(await sb.state('user_alice'),before);assert.equal(await b.getSleepGuestStore().upgrade(identity.guest_user_id),undefined);
      assert.equal((await sql.query('SELECT count(*)::int n FROM zook_frogsleep_personal_versions WHERE user_id=$1',[identity.guest_user_id])).rows[0].n,1);
    });
    await suite.test('migrations replay without losing raw resources or ownership receipts',async()=>{
      const before=(await sql.query('SELECT count(*)::int n FROM zook_frogsleep_personal_versions')).rows[0].n;
      const replay=await PostgresDatabase.create(url,buildDefaultSeed(undefined,{includeFrogSleep:true}));await replay.close();
      assert.equal((await sql.query('SELECT count(*)::int n FROM zook_frogsleep_personal_versions')).rows[0].n,before);
      assert.ok((await sql.query('SELECT count(*)::int n FROM zook_frogsleep_guest_upgrades')).rows[0].n>=2);
    });
  } finally {await sql.end();await b.close();await a.close();}
});
