import assert from "node:assert/strict";
import test from "node:test";
import { createServer } from "node:http";
import { randomUUID } from "node:crypto";
import { PostgresDatabase } from "../../src/infrastructure/database/postgres/postgres-database.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { createApplication } from "../../src/app.module.ts";
import { resolveBodyLogStores } from "../../src/application-bodylog-stores.ts";
const url = process.env.BODYLOG_TEST_DATABASE_URL?.trim();
if (!url) throw new Error("BODYLOG_TEST_DATABASE_URL must reference a disposable PostgreSQL database.");
test("local deployed HTTP/PostgreSQL two-account journey with real password authentication", async () => {
  const seed=buildDefaultSeed();
  const run=randomUUID().replaceAll("-", "");
  const aliceID=`bodylog_http_alice_${run}`,bobID=`bodylog_http_bob_${run}`;
  for(const id of [aliceID,bobID]) seed.users!.push({...seed.users![0],id,email:`${id}@example.com`});
  for(const userId of [aliceID,bobID]) seed.appUsers!.push({id:`bodylog_http_${userId}`,appId:"bodylog",userId,status:"ACTIVE",accountRegion:"GLOBAL",joinedAt:new Date().toISOString()});
  const database=await PostgresDatabase.create(url!,seed);
  const runtime=await createApplication({database,queueBackend:"memory"});
  const stores=resolveBodyLogStores(database);
  for(const flag of ["accountSocial","friends","growth"]) await stores.flags.updateBodyLogFeatureFlag(flag,true);
  const server=createServer(async (req,res)=>{
    try {
      const address=new URL(req.url!,"http://127.0.0.1");
      const chunks=[];for await(const chunk of req)chunks.push(chunk);
      const data=Buffer.concat(chunks).toString();
      const response=await runtime.app.handle({method:req.method as any,path:address.pathname,query:Object.fromEntries(address.searchParams),headers:req.headers as Record<string,string>,body:data?JSON.parse(data):undefined});
      res.writeHead(response.statusCode,{"Content-Type":"application/json",...response.headers});res.end(JSON.stringify(response.body));
    } catch {res.writeHead(500);res.end('{}');}
  });
  await new Promise<void>(resolve=>server.listen(0,"127.0.0.1",resolve));
  const base=`http://127.0.0.1:${(server.address() as any).port}`;
  const request=async(path:string,body?:unknown,token?:string,method=body===undefined?"GET":"POST",key?:string)=>{
    const response=await fetch(base+path,{method,headers:{"Content-Type":"application/json","X-App-ID":"bodylog",...(token?{Authorization:`Bearer ${token}`}:{ }),...(key?{"Idempotency-Key":key}:{})},body:body===undefined?undefined:JSON.stringify(body)});
    return {status:response.status,data:await response.json()};
  };
  try {
    const login=async(account:string)=>{
      const result=await request("/api/v1/auth/login",{appId:"bodylog",account,password:"Password1234",clientType:"app"});
      assert.equal(result.status,200);return result.data.data.accessToken as string;
    };
    const alice=await login(`${aliceID}@example.com`),bob=await login(`${bobID}@example.com`);
    const authRequired=await request("/api/v1/bodylog/entitlements");assert.equal(authRequired.status,401);
    for(const token of [alice,bob])assert.equal((await request("/api/v1/bodylog/profile",undefined,token)).status,200);
    const invitation=await request("/api/v1/bodylog/invitations",{installId:"http-alice-"+randomUUID()},alice);
    assert.equal(invitation.status,200);
    const attributed=await request("/api/v1/bodylog/invitations/attribute",{token:invitation.data.data.token,installId:`http-bob-${run}`},bob);
    assert.equal(attributed.status,200);
    assert.equal((await request("/api/v1/bodylog/invitations/attribute",{token:invitation.data.data.token,installId:`http-bob-${run}`},bob)).status,200);
    assert.equal((await request("/api/v1/bodylog/invitations",undefined,alice)).data.data.pendingCount,1);
    assert.equal((await request("/api/v1/bodylog/invitations",undefined,bob)).data.data.pendingCount,0);
    const pair=await request("/api/v1/bodylog/buddies",{partnerUserId:bobID,sharedHabitIds:["water"]},alice);
    assert.equal(pair.status,200);const pairId=pair.data.data.pair.id;
    assert.equal((await request(`/api/v1/bodylog/buddies/${pairId}/accept`,{},bob)).status,200);
    const operation=randomUUID();const encouragement={pairId,emoji:"💪",isSameAction:false};
    const first=await request("/api/v1/bodylog/buddies/encouragements",encouragement,alice,"POST",operation);
    assert.equal(first.status,200);
    const replay=await request("/api/v1/bodylog/buddies/encouragements",encouragement,alice,"POST",operation);
    assert.equal(replay.status,200);assert.equal(replay.data.data.id,first.data.data.id);
    const enrollment=await request("/api/v1/bodylog/seven-day-plan/enroll",{timeZone:"UTC"},bob);
    assert.equal(enrollment.status,200);const planId=enrollment.data.data.id;
    const aggregate={localDate:new Date().toISOString().slice(0,10),timeZone:"UTC",completedGoalCount:1,eligibleGoalCount:1,definitionVersion:1,eventId:randomUUID()};
    assert.equal((await request(`/api/v1/bodylog/seven-day-plan/${planId}/daily-aggregate`,aggregate,bob)).status,200);
    assert.equal((await request(`/api/v1/bodylog/seven-day-plan/${planId}`,undefined,alice)).status,403);
    assert.equal((await request("/api/v1/bodylog/invitations",undefined,bob)).data.data.inviteeProgressDays,1);
    assert.equal((await request(`/api/v1/bodylog/seven-day-plan/${planId}/daily-aggregate`,{...aggregate,completedGoalCount:0},bob)).status,200);
    assert.equal((await request("/api/v1/bodylog/invitations",undefined,bob)).data.data.inviteeProgressDays,0);
    assert.equal((await request("/api/v1/bodylog/blocks",{targetUserId:aliceID},bob)).status,200);
    assert.equal((await request("/api/v1/bodylog/buddies/encouragements",encouragement,alice,"POST",randomUUID())).status,403);
    assert.equal((await request("/api/v1/bodylog/entitlements",undefined,bob)).data.data.effective.isPremium,false);
    assert.equal((await request(`/api/v1/bodylog/buddies/${pairId}/dissolve`,{},bob)).status,200);
  } finally {await new Promise<void>(resolve=>server.close(()=>resolve()));await database.close();}
});
