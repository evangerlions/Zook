import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryJobQueue } from "../../src/infrastructure/queue/bullmq/in-memory-queue.ts";
import { RedisJobQueue } from "../../src/infrastructure/queue/bullmq/redis-queue.ts";
import { DeferJobError } from "../../src/infrastructure/queue/job-queue.ts";
import { LightTickScopePolicy, scopeQueue, restrictedRequest, validateRuntimeScope } from "../../src/modules/lighttick/lighttick-runtime-scope.ts";
import { strategyFixture } from "../support/lighttick-strategy-fixture.ts";
import { StrategyRunner } from "../../src/modules/lighttick/investments/strategies/strategy.runner.ts";
import { computeBacktest } from "../../src/modules/lighttick/investments/strategies/strategy.engine.ts";

test("scope suspension preserves the exact queue message without consuming attempts or blocking other Apps", async () => {
 const queue=new InMemoryJobQueue();
 const pending=await queue.add("lighttick.ai.run",{run_id:"original",user_id:"alice"},{jobId:"original-delivery",attempts:1});
 await queue.add("frogsleep.notification.send",{original:true},{jobId:"other-app",attempts:1});
 const seen:string[]=[];
 const start=new Date(Date.now()+1000);
 for(let i=0;i<4;i++) await queue.processDueJobs(job=>{if(job.id===pending.id)throw new DeferJobError();seen.push(job.id);},new Date(start.getTime()+i*60_001));
 assert.deepEqual(seen,["other-app"]);assert.equal(queue.deadLetterQueue.length,0);
 assert.equal(queue.jobs.length,1);assert.equal(queue.jobs[0].attemptsMade,0);
 assert.deepEqual(queue.jobs[0].payload,pending.payload);assert.equal(queue.jobs[0].id,pending.id);
 await queue.processDueJobs(job=>{seen.push(job.id);},new Date(start.getTime()+5*60_001));
 assert.equal(queue.jobs.length,0);assert.deepEqual(seen,["other-app",pending.id]);
});

test("Redis queue defers the existing message and retains its body and original retry budget", async () => {
 const original={id:"redis-original",name:"lighttick.ai.run",payload:{user_id:"alice",run_id:"same-run"},attemptsMade:0,maxAttempts:1,backoffMs:1000,availableAt:"2026-01-01T00:00:00Z"};
 const queue=new RedisJobQueue("redis://localhost:1") as any;let popped=false,saved:any;let deleted=0;
 queue.ensureConnected=async()=>{};
 queue.client={zPopMin:async()=>popped?null:(popped=true,{value:original.id,score:1}),get:async()=>JSON.stringify(original),set:async(_k:string,v:string)=>{saved=JSON.parse(v);},zAdd:async()=>1,del:async()=>{deleted++;}};
 await queue.processDueJobs(()=>{throw new DeferJobError();},new Date("2026-11-08T00:00:00Z"));
 assert.equal(deleted,0);assert.equal(saved.attemptsMade,0);assert.equal(saved.id,original.id);assert.deepEqual(saved.payload,original.payload);assert.equal(saved.availableAt,"2026-11-08T00:01:00.000Z");
});

test("optional enqueue is blocked, core notification enqueue remains allowed and cancellation patterns are exact", async () => {
 const q=new InMemoryJobQueue(), policy=new LightTickScopePolicy();
 const wrapped=scopeQueue(q,()=>policy.assertFull());
 await assert.rejects(wrapped.add("lighttick.ai.run",{}),{code:"LIGHTTICK_CAPABILITY_UNAVAILABLE"});
 await wrapped.add("lighttick.notification.send",{});assert.equal(q.jobs.length,1);
 assert.equal(restrictedRequest({method:"POST",path:"/api/v1/lighttick/investments/work/inv-original/cancel"}),false);
 assert.equal(restrictedRequest({method:"POST",path:"/api/v1/lighttick/investments/research/inv-original/cancel"}),true);
 assert.throws(()=>validateRuntimeScope("lighttick",JSON.stringify({settings:{runtimeScope:"FULL"}})),{statusCode:422});
});

test("a scope change during a real backtest rejects late publication while retaining immutable inputs", async () => {
 const f=await strategyFixture();let full=true;let release!:()=>void,started!:()=>void;
 const gate=new Promise<void>(r=>release=r), entered=new Promise<void>(r=>started=r);
 const runner=new StrategyRunner(f.s,async()=>{if(!full)throw Error("scope closed");},async input=>{started();await gate;return computeBacktest(input);});
 const w=await f.s.createRun(f.o,f.body,"scope-backtest-original");
 const before=(await f.s.store.work(f.o,w.id))!;const executing=runner.execute(f.o,w.id);
 await entered;full=false;release();await executing;
 const after=(await f.s.store.work(f.o,w.id))!;
 assert.equal(after.status,"failed");assert.equal(after.output,null);assert.deepEqual(after.input,before.input);
 assert.ok(after.error_code);assert.ok(await f.repo.getOperation(f.o,"scope-backtest-original"));
});

test("general AI cannot publish a late plan or use template fallback after scope withdrawal", async () => {
 const {InMemoryLightTickRepository}=await import("../../src/testing/in-memory-lighttick-repository.ts");
 const {LightTickAiRunner}=await import("../../src/modules/lighttick/ai/lighttick-ai-runner.ts");
 const {LightTickGoalService}=await import("../../src/modules/lighttick/lighttick-goal.service.ts");
 const repo=new InMemoryLightTickRepository(),owner={appId:"lighttick" as const,userId:"scope-ai"};
 const goal=await new LightTickGoalService(repo).create(owner,{title:"Synthetic plan",constraints:{}});
 const now=new Date().toISOString();const original={goal_id:goal.id,period_start:"2026-11-02",period_end:"2026-11-08",available_minutes:120};
 await repo.saveAiRun({...owner,id:"scope-ai-original",kind:"plan",status:"queued",sceneKey:"test",promptVersion:"1",schemaVersion:"1",attemptCount:0,inputContext:original,usage:{},createdAt:now,updatedAt:now});
 let full=true;let release!:()=>void,started!:()=>void;const gate=new Promise<void>(r=>release=r),entered=new Promise<void>(r=>started=r);
 const guard=async()=>{if(!full)throw new (await import("../../src/shared/errors.ts")).ApplicationError(503,"LIGHTTICK_CAPABILITY_UNAVAILABLE","Scope closed");};
 const runner=new LightTickAiRunner(repo,{complete:async()=>{started();await gate;return {provider:"fixture",modelKey:"fixture",providerModel:"fixture",text:JSON.stringify({tasks:[{title:"Must not appear",estimated_minutes:30}]})};}} as any,undefined,undefined,guard);
 const executing=runner.execute(owner,"scope-ai-original","week_plan");await entered;full=false;release();const result=await executing;
 assert.equal(result.status,"failed");assert.equal(result.errorCode,"LIGHTTICK_CAPABILITY_UNAVAILABLE");assert.equal(result.output,undefined);
 assert.equal((await repo.listPlans(owner)).length,0);assert.deepEqual((await repo.getAiRun(owner,"scope-ai-original"))!.inputContext,original);
});

test("a failing config store fails closed without starving the shared queue", async () => {
 const policy=new LightTickScopePolicy(async()=>{throw Error("store unavailable");});
 assert.equal(await policy.current(),"core");
 await assert.rejects(policy.assertFull(),{code:"LIGHTTICK_CAPABILITY_UNAVAILABLE"});
});

test("late AI completion after owner deletion cannot recreate the run or a fallback plan", async () => {
 const {InMemoryLightTickRepository}=await import("../../src/testing/in-memory-lighttick-repository.ts");
 const {LightTickAiRunner}=await import("../../src/modules/lighttick/ai/lighttick-ai-runner.ts");
 const repo=new InMemoryLightTickRepository(),o={appId:"lighttick" as const,userId:"deleted-scope-owner"};const now=new Date().toISOString();
 await repo.saveAiRun({...o,id:"scope-deleted-run",kind:"plan",status:"queued",sceneKey:"test",promptVersion:"1",schemaVersion:"1",attemptCount:0,inputContext:{period_start:"2026-11-02",period_end:"2026-11-08",available_minutes:120},usage:{},createdAt:now,updatedAt:now});
 let active=true;
 const runner=new LightTickAiRunner(repo,{complete:async()=>{await repo.deleteOwnerData(o);active=false;return {provider:"fixture",providerModel:"fixture",text:JSON.stringify({tasks:[{title:"Never recreate",estimated_minutes:30}]})};}} as any,undefined,undefined,async()=>{if(!active)throw new (await import("../../src/shared/errors.ts")).ApplicationError(403,"APP_SCOPE_FORBIDDEN","Owner deleted");});
 await runner.execute(o,"scope-deleted-run","week_plan");
 assert.equal(await repo.getAiRun(o,"scope-deleted-run"),undefined);assert.equal((await repo.listPlans(o)).length,0);
});
