import test from "node:test";
import assert from "node:assert/strict";
import { createApplication } from "../../src/app.module.ts";
import { InMemoryDatabase } from "../../src/testing/in-memory-database.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";

async function fixture(scope?: string) {
  const seed = buildDefaultSeed(undefined, { includeLightTick: true });
  for(const userId of ["user_alice","user_bob"]) seed.appUsers.push({ id: "scope-"+userId, appId: "lighttick", userId, status: "ACTIVE", accountRegion: "UNKNOWN", joinedAt: new Date().toISOString() });
  const app = await createApplication({ seed, lighttickEnabled: true, appEnvironment: "test", databaseFactory: s => new InMemoryDatabase(s) });
  const setScope = async (value?: string) => app.services.appConfigService.setValue("lighttick", "admin.delivery_config", JSON.stringify({ enabled: true, settings: value === undefined ? {} : { runtimeScope: value } }));
  await setScope(scope);
  const token = app.services.tokenService.issueAccessToken("user_alice", "lighttick");
  const call = (path: string, method = "GET", body?: unknown, userToken = token, key = "scope-original-request") => app.app.handle({ method, path: "/api/v1/lighttick/" + path, body, headers: { authorization: "Bearer " + userToken, "x-app-id": "lighttick", "x-lighttick-task-schema": "2", "idempotency-key": key } });
  return { app, call, setScope, runtime: app.services.lighttickRuntime! };
}

test("missing scope closes optional mutations while goals, published reads and historical reads stay available", async () => {
  const { call, runtime } = await fixture();
  const config = (await call("public/config")).body.data as any;
  assert.equal(config.runtime_scope, "core");
  for (const [path,method] of [
    ["investments/instruments","POST"], ["investments/research/inv-synthetic","PUT"],
    ["investments/materials/inv-synthetic","PUT"], ["investments/strategies","POST"],
    ["investments/observations","POST"], ["ai/model-settings/tests","POST"],
    ["account/github/tests","POST"], ["learning/work","POST"],
    ["learning/routes/plan-synthetic","PUT"], ["planning-sessions","POST"],
    ["plan-runs","POST"], ["coach-runs","POST"], ["review-runs","POST"],
    ["change-proposal-runs","POST"], ["onboarding","POST"],
    ["form-records","PUT"],
  ]) {
    const r = await call(path,method,{});
    assert.equal(r.statusCode,503,path+JSON.stringify(r.body));
    assert.equal(r.body.code,"LIGHTTICK_CAPABILITY_UNAVAILABLE",path);
  }
  assert.equal((await call("goals","POST",{title:"Core manual goal"})).statusCode,201);
  assert.equal((await call("investments/instruments")).statusCode,200);
  assert.equal((await call("form-records")).statusCode,200);

});

test("scope is loaded live, unknown configuration fails closed and another product cannot bypass it", async () => {
  const { app, call, setScope } = await fixture("full");
  assert.equal(((await call("public/config")).body.data as any).runtime_scope,"full");
  assert.equal((await call("investments/instruments","POST",{})).statusCode,422);
  await setScope("core");
  assert.equal((await call("investments/instruments","POST",{})).body.code,"LIGHTTICK_CAPABILITY_UNAVAILABLE");
  await setScope("FULL");
  assert.equal(((await call("public/config")).body.data as any).runtime_scope,"core");
  assert.equal((await call("investments/instruments","POST",{},app.services.tokenService.issueAccessToken("user_alice","frogsleep"))).statusCode,403);
});

test("restricted worker delivery and recovery preserve durable work and never dispatch optional runners", async () => {
  const { runtime, setScope } = await fixture("core");
  let executions = 0, scans = 0;
  const runner = runtime.worker!.investments!;
  runner.execute = async () => { executions++; };
  runner.recover = async () => { scans++; return 1; };
  // Isolate this scan while preserving the actual application worker policy.
  for(const name of ["learning","market","modelTests","githubTests","researchAI","screening","observations","strategies","portfolio"] as const) runtime.worker![name]!.recover = async () => 0;
  const job = { id:"scope-job", name:"lighttick.investment.ledger", payload:{app_id:"lighttick",user_id:"user_alice",work_id:"inv-synthetic"}, attemptsMade:0,maxAttempts:1 } as any;
  await assert.rejects(runtime.worker!.process(job), { message: "Job execution is temporarily suspended by product scope." });
  assert.equal(await runtime.worker!.recover(),0);
  assert.equal(executions,0); assert.equal(scans,0);
  await setScope("full");
  await runtime.worker!.process(job);
  assert.equal(await runtime.worker!.recover(),1);
  assert.equal(executions,1); assert.equal(scans,1);
});

test("scope shrink preserves settings receipts and allows durable cancellation, including replay", async () => {
 const {app,call,setScope,runtime}=await fixture("full");
 const saved=await call("ai/model-settings","PUT",{base_revision:0,mode:"platform",base_url:null,model_name:null,api_key:null});
 assert.equal(saved.statusCode,200,JSON.stringify(saved.body));
 const owner={appId:"lighttick" as const,userId:"user_alice"};
 const {InvestmentService}=await import("../../src/modules/lighttick/investments/investment.service.ts");
 const service=new InvestmentService(runtime.repository);
 await service.createAccount(owner,"inv-scope-account",{base_revision:0,name:"Synthetic scope",currency:"CNY",baseline_date:"2026-01-01",opening_cash:"100",opening_positions:[]},"scope-account-original");
 const work=await runtime.investmentLedger!.append(owner,"inv-scope-account",{base_revision:1,business_date:"2026-01-02",kind:"cash",cash:{kind:"deposit",amount:"1"}},"scope-cash-original");
 const before=structuredClone((await runtime.repository.investments.ledger.get(owner,work.id))!.input);
 await setScope("core");
 const receipt=await call("ai/model-settings/receipts/scope-original-request");
 assert.equal(receipt.statusCode,200);assert.equal((receipt.body.data as any).revision,1);
 const cancelled=await call("investments/work/"+work.id+"/cancel","POST",{base_revision:work.revision},undefined,"scope-cancel-original");
 assert.equal(cancelled.statusCode,200,JSON.stringify(cancelled.body));
 assert.equal((cancelled.body.data as any).status,"cancelled");
 const replay=await call("investments/work/"+work.id+"/cancel","POST",{base_revision:work.revision},undefined,"scope-cancel-original");
 assert.equal(replay.statusCode,200);assert.deepEqual(replay.body.data,cancelled.body.data);
 assert.deepEqual((await runtime.repository.investments.ledger.get(owner,work.id))!.input,before);
 assert.equal((await runtime.repository.investments.ledger.events(owner,"inv-scope-account")).length,0);
 const bobToken=app.services.tokenService.issueAccessToken("user_bob","lighttick");
 assert.equal((await call("ai/model-settings/receipts/scope-original-request","GET",undefined,bobToken)).statusCode,404);
});

test("core scope keeps published learning, private notes and explicit completion independently writable", async () => {
 const {runtime,call,setScope}=await fixture("full");
 const {NativeLearningService}=await import("../../src/modules/lighttick/learning/native-learning.service.ts");
 runtime.nativeLearning=new NativeLearningService(runtime.repository,true);
 const collection=await call("learning/collections/collection-scope-api","PUT",{title:"Synthetic published course",archived:false,base_revision:0},undefined,"scope-create-collection");
 assert.equal(collection.statusCode,200,JSON.stringify(collection.body));
 const publication=await call("learning/lessons/lesson-scope-api/publications","PUT",{collection_id:"collection-scope-api",number:1,title:"Published lesson",content:"Synthetic published content",references:"",base_revision:0},undefined,"scope-publish-original");
 assert.equal(publication.statusCode,200,JSON.stringify(publication.body));
 const lesson=publication.body.data as any;
 await setScope("core");
 assert.equal((await call("learning/lessons/"+lesson.id)).statusCode,200);
 const notes=await call("learning-library/"+lesson.id+"/private","POST",{id:"scope-note-original",content_version:lesson.content_version,revision:1,action:"save",notes:"Core private note",answers:[],position:0},undefined,"scope-note-original");
 assert.equal(notes.statusCode,200,JSON.stringify(notes.body));assert.equal((notes.body.data as any).operations[0].status,"applied");
 const before=(await call("learning-library/"+lesson.id+"/private")).body.data as any;
 assert.equal(before.state.notes,"Core private note");assert.equal(before.state.completed,false);
 const completion=await call("learning-library/"+lesson.id+"/private","POST",{id:"scope-complete-original",content_version:lesson.content_version,revision:before.state.revision,action:"complete",notes:before.state.notes,answers:[],position:0},undefined,"scope-complete-original");
 assert.equal(completion.statusCode,200,JSON.stringify(completion.body));assert.equal((completion.body.data as any).operations[0].status,"applied");
 assert.equal(((await call("learning-library/"+lesson.id+"/private")).body.data as any).state.completed,true);
 assert.equal((await call("learning/work","POST",{},undefined,"scope-no-generate")).body.code,"LIGHTTICK_CAPABILITY_UNAVAILABLE");
});

test("core form receipt lookup returns only the exact owner's historical result without restoring it", async () => {
 const {runtime,call,setScope,app}=await fixture("full");
 const {FormRecordsService,emptyFormRecords}=await import("../../src/modules/lighttick/form-records/form-records.service.ts");
 const owner={appId:"lighttick" as const,userId:"user_alice"},service=new FormRecordsService(runtime.repository);
 await service.save(owner,{base_revision:0,data:{...emptyFormRecords(),customRecords:[{text:"Historical scope receipt"}]}},"scope-form-receipt");
 await service.clear(owner,{base_revision:1},"scope-form-clear");await setScope("core");
 const result=await call("form-records/receipts/scope-form-receipt");assert.equal(result.statusCode,200,JSON.stringify(result.body));
 assert.equal((result.body.data as any).revision,1);assert.equal((result.body.data as any).data.customRecords[0].text,"Historical scope receipt");
 assert.equal((await service.read(owner)).revision,2);assert.equal((await service.read(owner)).data.customRecords.length,0);
 const token=app.services.tokenService.issueAccessToken("user_bob","lighttick");assert.equal((await call("form-records/receipts/scope-form-receipt","GET",undefined,token)).statusCode,404);
 assert.equal((await call("form-records/receipts/unknown-original-key")).statusCode,404);
 assert.equal((await call("form-records/receipts/short")).statusCode,422);
});
