import test from "node:test";
import assert from "node:assert/strict";
import { Pool } from "pg";
import { runPostgresMigrations } from "../../src/infrastructure/database/postgres/migrate.ts";
import { PostgresLightTickRepository } from "../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts";
import { createApplication } from "../../src/app.module.ts";
import { InMemoryDatabase } from "../../src/testing/in-memory-database.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { InvestmentService } from "../../src/modules/lighttick/investments/investment.service.ts";
import { InvestmentLedgerRunner, calculateLedger } from "../../src/modules/lighttick/investments/ledger.runner.ts";
const dsn=process.env.LIGHTTICK_TEST_DATABASE_URL;
if(!dsn || new URL(dsn).hostname!=="127.0.0.1" || new URL(dsn).port!=="58651" || new URL(dsn).pathname!=="/grow_web_u1_f11")throw Error("Dedicated synthetic scope PG required");

test("PG scope isolation preserves late-write rollback, original inputs, cancellation and reconnect", {timeout:30000}, async()=>{
 await runPostgresMigrations({connectionString:dsn!,log:()=>{}});
 const pool=new Pool({connectionString:dsn,application_name:"scope-runtime-pg"}),repo=new PostgresLightTickRepository(pool);
 try {
  const seed=buildDefaultSeed(undefined,{includeLightTick:true});
  seed.appUsers.push({id:"scope-pg-alice",appId:"lighttick",userId:"user_alice",status:"ACTIVE",accountRegion:"UNKNOWN",joinedAt:new Date().toISOString()});
  const app=await createApplication({seed,lighttickEnabled:true,appEnvironment:"test",databaseFactory:s=>new InMemoryDatabase(s),lighttickRepository:repo});
  const rt=app.services.lighttickRuntime!, owner={appId:"lighttick" as const,userId:"user_alice"};
  const scope=(value:string)=>app.services.appConfigService.setValue("lighttick","admin.delivery_config",JSON.stringify({enabled:true,settings:{runtimeScope:value}}));
  const token=app.services.tokenService.issueAccessToken(owner.userId,"lighttick");
  const call=(path:string,body:unknown,key:string)=>app.app.handle({method:"POST",path:"/api/v1/lighttick/"+path,body,headers:{authorization:"Bearer "+token,"idempotency-key":key,"x-app-id":"lighttick"}});
  await scope("full");
  let release!:()=>void,started!:()=>void;const gate=new Promise<void>(r=>release=r),entered=new Promise<void>(r=>started=r);
  const held=repo.transaction(owner,async()=>{started();await gate;});await entered;
  const pending=call("investments/instruments",{market:"SSE",kind:"stock",code:"600001.SH",name:"Must not be saved"},"scope-pg-late-write");
  let waiting=false;
  try {
   for(let n=0;n<100;n++){const q=await pool.query("SELECT count(*)::int AS n FROM pg_stat_activity WHERE application_name='scope-runtime-pg' AND wait_event_type='Lock'");if(q.rows[0].n>0){waiting=true;break;}await new Promise(r=>setTimeout(r,10));}
   assert.ok(waiting,"Request must actually wait for the owner lock");await scope("core");
  } finally {release();await held;}
  assert.equal((await pending).body.code,"LIGHTTICK_CAPABILITY_UNAVAILABLE");
  assert.equal((await repo.investments.instruments(owner)).length,0);
  assert.equal(await repo.getOperation(owner,"scope-pg-late-write"),undefined);
  const service=new InvestmentService(repo),account="inv-scope-pg-"+process.pid;
  await scope("full");
  await service.createAccount(owner,account,{base_revision:0,name:"Synthetic scope",currency:"CNY",baseline_date:"2026-01-01",opening_cash:"100",opening_positions:[]},"scope-pg-account-"+process.pid);
  const body={base_revision:1,business_date:"2026-01-02",kind:"cash",cash:{kind:"deposit",amount:"1"}};
  const work=await rt.investmentLedger!.append(owner,account,body,"scope-pg-append-"+process.pid);
  const original=(await repo.investments.ledger.get(owner,work.id))!;
  await scope("core");
  await assert.rejects(rt.worker!.process({id:"original-delivery",name:"lighttick.investment.ledger",payload:{app_id:"lighttick",user_id:owner.userId,work_id:work.id},attemptsMade:0,maxAttempts:1,backoffMs:1000,availableAt:new Date().toISOString()}),/temporarily suspended/);
  assert.equal((await repo.investments.ledger.get(owner,work.id))!.status,"queued");
  const cancelled=await call("investments/work/"+work.id+"/cancel",{base_revision:work.revision},"scope-pg-cancel-"+process.pid);
  assert.equal(cancelled.statusCode,200,JSON.stringify(cancelled.body));
  const replay=await call("investments/work/"+work.id+"/cancel",{base_revision:work.revision},"scope-pg-cancel-"+process.pid);
  assert.deepEqual(replay.body.data,cancelled.body.data);
  // A second command starts under full scope; its completed calculation must not
  // append a financial fact if scope shrinks during computation.
  await scope("full");const late=await rt.investmentLedger!.append(owner,account,body,"scope-pg-late-work-"+process.pid);
  let done!:()=>void,computing!:()=>void;const finish=new Promise<void>(r=>done=r),began=new Promise<void>(r=>computing=r);
  const runner=new InvestmentLedgerRunner(rt.investmentLedger!,rt.worker!.investments!.authorizeOwner,async(a,e)=>{computing();await finish;return calculateLedger(a,e);});
  const running=runner.execute(owner,late.id);await began;await scope("core");done();await running;
  assert.equal((await repo.investments.ledger.get(owner,late.id))!.status,"failed");
  assert.equal((await repo.investments.ledger.events(owner,account)).length,0);
  const {FormRecordsService,emptyFormRecords}=await import("../../src/modules/lighttick/form-records/form-records.service.ts");
  const formsOwner={...owner,userId:"scope-receipt-pg-"+process.pid},forms=new FormRecordsService(repo);
  await forms.save(formsOwner,{base_revision:0,data:{...emptyFormRecords(),customRecords:[{text:"Original receipt"}]}},"scope-pg-form-original");
  await forms.clear(formsOwner,{base_revision:1},"scope-pg-form-clear");
  assert.equal((await forms.receipt(formsOwner,"scope-pg-form-original")).revision,1);
  assert.equal((await forms.read(formsOwner)).revision,2);
  await assert.rejects(forms.receipt({...formsOwner,userId:"foreign"},"scope-pg-form-original"),{statusCode:404});
  const peerPool=new Pool({connectionString:dsn});try {
   const peer=new PostgresLightTickRepository(peerPool), restored=(await peer.investments.ledger.get(owner,work.id))!;
   assert.equal(restored.status,"cancelled");assert.deepEqual(restored.input,original.input);
   assert.equal((await peer.investments.account(owner,account))!.revision,1);
  } finally {await peerPool.end();}
 } finally {await pool.end();}
});
