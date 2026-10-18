import { createServer } from "node:http";
import assert from 'node:assert/strict';
import test from 'node:test';
import { createJourneyServer } from '../helpers/frogsleep-journey-server.ts';
import { runSleepDevAcceptance,validateSleepDevUrl } from '../../scripts/lib/frogsleep-dev-acceptance.mjs';

test('dev acceptance rejects production origins and embedded credentials',()=>{
  for(const value of ['https://app-dev.youwoai.net:3100','ftp://127.0.0.1','https://app.youwoai.net','https://example.com','https://user:password@app-dev.youwoai.net','http://app-dev.youwoai.net','https://app-dev.youwoai.net/private']) assert.throws(()=>validateSleepDevUrl(value));
});
test('real HTTP dev acceptance covers raw restore, safe upgrade, rollback and deletion isolation',async()=>{
  const server=await createJourneyServer();
  try {
    const result=await runSleepDevAcceptance({baseUrl:server.url,account:{account:'alice@example.com',password:'Password1234'},deletionAccount:{account:'bob@example.com',password:'Password1234'}});
    assert.equal(result.passed,true,result.failure??result.cleanup_failures.join('; '));
    assert.equal(result.complete,true);assert.ok(result.checks.length>80);
    const db=server.database();assert.equal((await db.findAppUser('frogsleep','user_bob'))?.status,'DELETED');
    assert.equal((await db.findUserById('user_bob'))?.status,'ACTIVE');
    assert.equal((await db.findAppUser('frogsleep','user_alice'))?.status,'ACTIVE');
    assert.ok(!JSON.stringify(result).includes('Password1234'));assert.ok(!JSON.stringify(result).includes('fs_upg_'));assert.ok(!JSON.stringify(result).includes('access_token'));
  } finally {await server.close();}
});
test('guest-only evidence stays partial while testing its own deletion and clearing its data',async()=>{
  const server=await createJourneyServer();
  try {
    const result=await runSleepDevAcceptance({baseUrl:server.url});
    assert.equal(result.passed,true,result.failure??result.cleanup_failures.join('; '));assert.equal(result.complete,false);assert.equal(result.guest_upgrade,false);
    assert.ok(server.database().appUsers.filter(u=>u.userId.startsWith('sleep_guest_')).every(u=>u.status==='DELETED'));
  } finally {await server.close();}
});

test('dev acceptance never forwards secret POST bodies to a redirect target',async()=>{
  let targetRequests=0;
  const destination=createServer((_req,res)=>{targetRequests++;res.end('{}');});
  await new Promise<void>(resolve=>destination.listen(0,'127.0.0.1',resolve));
  const targetPort=(destination.address() as {port:number}).port;
  const source=createServer((req,res)=>{
    if(req.url==='/api/health'){res.setHeader('content-type','application/json');res.end(JSON.stringify({code:'OK',data:{status:'ok',version:'test'}}));return;}
    res.writeHead(307,{location:`http://127.0.0.1:${targetPort}${req.url}`});res.end();
  });
  await new Promise<void>(resolve=>source.listen(0,'127.0.0.1',resolve));
  try {
    const port=(source.address() as {port:number}).port;
    const result=await runSleepDevAcceptance({baseUrl:`http://127.0.0.1:${port}`,checkCors:false});
    assert.equal(result.passed,false);assert.equal(targetRequests,0);
    assert.equal(result.checks.length,1);
  } finally {
    await Promise.all([new Promise<void>(resolve=>source.close(()=>resolve())),new Promise<void>(resolve=>destination.close(()=>resolve()))]);
  }
});
