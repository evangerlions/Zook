import { Client } from "pg";
import { randomBytes } from "node:crypto";
import { PersonalSyncService } from "../../src/modules/frogsleep/personal-sync/personal-sync.service.ts";
import assert from 'node:assert/strict';
import test from 'node:test';
import { createServer } from 'node:http';
import { createApplication } from '../../src/app.module.ts';
import { PostgresDatabase } from '../../src/infrastructure/database/postgres/postgres-database.ts';
import { readRequestBody } from '../../src/infrastructure/http/request-body.ts';
import { buildCorsHeaders,buildCorsPreflightHeaders } from '../../src/infrastructure/http/cors.ts';
import { runSleepDevAcceptance } from '../../scripts/lib/frogsleep-dev-acceptance.mjs';
const url=process.env.FROGSLEEP_TEST_DATABASE_URL;
if(!url)throw new Error('FROGSLEEP_TEST_DATABASE_URL must reference a disposable database.');
test('real HTTP PostgreSQL acceptance rolls back failed guest upgrade before error conversion',async()=>{
  const runtime=await createApplication({frogsleepEnabled:true,queueBackend:'memory',databaseFactory:seed=>PostgresDatabase.create(url,seed)});
  const sql=new Client({connectionString:url});await sql.connect();
  const server=createServer(async(req,res)=>{
    try {
      const location=new URL(req.url??'/','http://127.0.0.1');
      const origin=req.headers.origin;
      if(req.method==='OPTIONS') {
        for(const [key,value]of Object.entries(buildCorsPreflightHeaders(origin,req.headers['access-control-request-headers'] as string|undefined)))res.setHeader(key,value);
        res.statusCode=204;res.end();return;
      }
      const response=await runtime.app.handle({method:req.method??'GET',path:location.pathname,query:Object.fromEntries(location.searchParams),headers:Object.fromEntries(Object.entries(req.headers).map(([k,v])=>[k,Array.isArray(v)?v.join(','):v])),body:await readRequestBody(req,req.headers['content-type']),ipAddress:'127.0.0.1'});
      res.statusCode=response.statusCode;res.setHeader('content-type','application/json');
      for(const [key,value]of Object.entries({...buildCorsHeaders(origin),...response.headers}))res.setHeader(key,value);
      res.end(JSON.stringify(response.body));
    }catch{res.statusCode=500;res.end('{}');}
  });
  await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  try {
    const port=(server.address() as {port:number}).port;
    const result=await runSleepDevAcceptance({baseUrl:`http://127.0.0.1:${port}`,account:{account:'alice@example.com',password:'Password1234'},deletionAccount:{account:'bob@example.com',password:'Password1234'}});
    assert.equal(result.passed,true,result.failure??result.cleanup_failures.join('; '));assert.equal(result.complete,true);
    assert.equal((await runtime.database.findAppUser('frogsleep','user_bob'))?.status,'DELETED');
    const login=await runtime.services.authService.login({appId:'frogsleep',account:'alice@example.com',password:'Password1234'});
    const invoke=(path:string,body:unknown,headers:Record<string,string>={})=>runtime.app.handle({method:'POST',path:'/api/v1/frogsleep'+path,body,headers:{authorization:`Bearer ${login.accessToken}`,...headers}});
    const guest=(await invoke('/account/guest-sessions',{device_id:'post-commit-device',device_secret:randomBytes(32).toString('base64url'),platform:'ios'},{'idempotency-key':'post-commit-create'})).body.data as any;
    const sync=new PersonalSyncService(runtime.database.getPersonalSyncRepository());
    await sync.write(guest.guest_user_id,'sleep_session','post-commit-resource',{},false);
    const epoch=(await sync.state('user_alice')).sync_epoch;
    const proof={guest_user_id:guest.guest_user_id,guest_upgrade_token:guest.guest_upgrade_token,device_id:'post-commit-device',confirmed:true};
    const headers={'idempotency-key':'post-commit-upgrade','x-sync-epoch':epoch};
    const revoke=runtime.services.authService.revokeAllSessions;let committedBeforeRevoke=false;
    runtime.services.authService.revokeAllSessions=async()=>{
      const membership=(await sql.query("SELECT status FROM zook_app_users WHERE app_id='frogsleep' AND user_id=$1",[guest.guest_user_id])).rows[0];
      const receipt=(await sql.query('SELECT count(*)::int n FROM zook_frogsleep_guest_upgrades WHERE guest_user_id=$1',[guest.guest_user_id])).rows[0];
      committedBeforeRevoke=membership?.status==='DELETED'&&receipt.n===1;
      throw new Error('injected KV failure after SQL commit');
    };
    try {assert.equal((await invoke('/account/upgrade',proof,headers)).statusCode,500);}finally{runtime.services.authService.revokeAllSessions=revoke;}
    assert.equal(committedBeforeRevoke,true,'SQL ownership must be visible to another connection before session cleanup.');
    const replay=await invoke('/account/upgrade',proof,headers);assert.equal(replay.statusCode,200);assert.equal((replay.body.data as any).migrated_data_count,1);

  } finally {await new Promise<void>(resolve=>server.close(()=>resolve()));await sql.end();await runtime.database.close();}
});
