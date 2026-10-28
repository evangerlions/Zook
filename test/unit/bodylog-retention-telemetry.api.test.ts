import assert from "node:assert/strict";
import test from "node:test";
import { randomUUID } from "node:crypto";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { createApplication } from "../support/create-test-application.ts";
import { resolveBodyLogStores } from "../../src/application-bodylog-stores.ts";
const design = { owner:"qa-analysis",primaryMetric:"d7_local_goal_retention",baselineRate:0.3,minimumDetectableEffect:0.05,targetMaturePerVariant:2000,minimumEnrollmentDays:14,followupDays:8,lateArrivalDays:7,stopPolicy:"fixed_horizon_no_peeking",guardrails:{maxAuthFailureRate:0.02,maxDuplicateOperations:0,maxLocalActionP95Millis:500} };
async function setup() {
  const seed = buildDefaultSeed();
  seed.apps!.push({ id:"bodylog", code:"bodylog", name:"BodyLog", nameI18n:{"zh-CN":"BodyLog","en-US":"BodyLog"}, status:"ACTIVE", apiDomain:"bodylog.test",joinMode:"AUTO",createdAt:new Date().toISOString() });
  seed.appUsers!.push({id:"telemetry-member",appId:"bodylog",userId:"user_alice",status:"ACTIVE",joinedAt:new Date().toISOString()});
  const runtime = await createApplication({seed});
  await resolveBodyLogStores(runtime.database).flags.updateBodyLogFeatureFlag("growth",true);
  const call = (body: unknown) => runtime.app.handle({method:"POST",path:"/api/v1/bodylog/retention/events",headers:{authorization:`Bearer ${runtime.services.tokenService.issueAccessToken("user_alice","bodylog")}`},body});
  const event = {eventId:randomUUID(), name:"local_goal_completed",properties:{source:"home", action:"complete"},timestamp:new Date().toISOString(),consent:true};
  return {runtime,call,event};
}
test("retention telemetry requires explicit consent and a closed event/property allowlist",async()=>{
  const {runtime,call,event}=await setup();
  for(const patch of [{consent:false},{consent:undefined},{name:"personal_health_record"},{properties:{source:"alice@example.com"}},{properties:{habit_name:"Private habit"}}])
    assert.equal((await call({...event,...patch})).statusCode,400);
  assert.deepEqual(await runtime.database.listAnalyticsEvents("bodylog"),[]);
});
test("retention event retries store one account-scoped fact without client-chosen experiment or identity",async()=>{
  const {runtime,call,event}=await setup();
  for(let i=0;i<3;i++) assert.equal((await call({...event,userId:"user_bob",variant:"treatment"})).statusCode,200);
  const events=await runtime.database.listAnalyticsEvents("bodylog");
  assert.equal(events.length,1);assert.equal(events[0].userId,"user_alice");
  assert.equal(events[0].metadata.variant,"control");
});

test("retention cohorts start at completed-plan exposure and only include mature D1/D7 action days",async t=>{
  t.mock.timers.enable({apis:["Date"],now:new Date("2026-10-01T12:00:00Z")});
  const {runtime,call}=await setup();
  await runtime.database.upsertAppConfig({id:"retention-experiment",appId:"bodylog",configKey:"bodylog.retention-experiment",configValue:JSON.stringify({id:"continue-v1",enabled:true,treatmentPercent:50,design}),updatedAt:new Date().toISOString()});
  const {BodyLogRetentionTelemetry}=await import("../../src/modules/bodylog/bodylog-retention-telemetry.ts");
  const telemetry=new BodyLogRetentionTelemetry(runtime.database);
  const assignment=await telemetry.assignment("user_alice");
  assert.deepEqual(await telemetry.assignment("user_alice"),assignment);
  const event=(name:string,properties:Record<string,string>)=>({eventId:randomUUID(),name,properties,timestamp:new Date().toISOString(),consent:true});
  assert.equal((await call(event("seven_day_plan_opened",{source:"plan",state:"completed"}))).statusCode,200);
  let metrics=await telemetry.metrics();
  let variant=metrics.experiments[0]!.variants.find(item=>item.variant===assignment.variant)!;
  assert.equal(variant.d1.eligible,0);assert.equal(variant.d7.rate,null);
  t.mock.timers.tick(86_400_000);
  assert.equal((await call(event("local_goal_completed",{source:"home",action:"complete"}))).statusCode,200);
  t.mock.timers.tick(6*86_400_000);
  assert.equal((await call(event("local_goal_completed",{source:"home",action:"complete"}))).statusCode,200);
  t.mock.timers.tick(86_400_000);
  metrics=await telemetry.metrics();variant=metrics.experiments[0]!.variants.find(item=>item.variant===assignment.variant)!;
  assert.deepEqual(variant.d1,{eligible:1,retained:1,rate:1});
  assert.deepEqual(variant.d7,{eligible:1,retained:1,rate:1});
});

test("disabled and malformed experiment configuration cannot enroll treatment",async()=>{
  const {runtime}=await setup();
  const {BodyLogRetentionTelemetry}=await import("../../src/modules/bodylog/bodylog-retention-telemetry.ts");
  const telemetry=new BodyLogRetentionTelemetry(runtime.database);
  for(const config of [{id:"v1",enabled:false,treatmentPercent:50},{id:"v1",enabled:true,treatmentPercent:99},{id:"private text",enabled:true,treatmentPercent:20}]) {
    await runtime.database.upsertAppConfig({id:"experiment-config",appId:"bodylog",configKey:"bodylog.retention-experiment",configValue:JSON.stringify(config),updatedAt:new Date().toISOString()});
    assert.deepEqual(await telemetry.assignment("user_alice"),{experimentId:"disabled",variant:"control"});
  }
});

test("actions assigned to another experiment do not count toward the old cohort",async t=>{
  t.mock.timers.enable({apis:["Date"],now:new Date("2026-10-01T12:00:00Z")});
  const {runtime,call}=await setup();
  const set=async(id:string)=>runtime.database.upsertAppConfig({id:"exp",appId:"bodylog",configKey:"bodylog.retention-experiment",configValue:JSON.stringify({id,enabled:true,treatmentPercent:50,design}),updatedAt:new Date().toISOString()});
  const {BodyLogRetentionTelemetry}=await import("../../src/modules/bodylog/bodylog-retention-telemetry.ts");
  const telemetry=new BodyLogRetentionTelemetry(runtime.database);
  const event=(name:string,properties:Record<string,string>)=>({eventId:randomUUID(),name,properties,timestamp:new Date().toISOString(),consent:true});
  await set("old");await call(event("seven_day_plan_opened",{source:"plan",state:"completed"}));
  t.mock.timers.tick(86_400_000);await set("new");await call(event("local_goal_completed",{source:"home",action:"complete"}));
  t.mock.timers.tick(86_400_000);
  const metrics=await telemetry.metrics();
  assert.equal(metrics.experiments[0]!.variants.reduce((n,row)=>n+row.d1.retained,0),0);
});

test("retention day matures at next UTC midnight, not one second early",async t=>{
  t.mock.timers.enable({apis:["Date"],now:new Date("2026-10-01T12:00:00Z")});
  const {runtime,call,event}=await setup();
  await runtime.database.upsertAppConfig({id:"exp",appId:"bodylog",configKey:"bodylog.retention-experiment",configValue:JSON.stringify({id:"v1",enabled:true,treatmentPercent:50,design}),updatedAt:new Date().toISOString()});
  await call({...event,name:"seven_day_plan_opened",properties:{source:"plan",state:"completed"}});
  t.mock.timers.tick(Date.parse("2026-10-02T23:59:59.500Z")-Date.now());
  const {BodyLogRetentionTelemetry}=await import("../../src/modules/bodylog/bodylog-retention-telemetry.ts");
  const result=await new BodyLogRetentionTelemetry(runtime.database).metrics();
  assert.equal(result.experiments[0]!.variants.reduce((n,row)=>n+row.d1.eligible,0),0);
});
