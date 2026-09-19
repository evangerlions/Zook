import assert from "node:assert/strict";
import test, { after } from "node:test";
import { Pool } from "pg";
import { runPostgresMigrations } from "../../src/infrastructure/database/postgres/migrate.ts";
import { PostgresLightTickRepository } from "../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts";
const connectionString = process.env.LIGHTTICK_TEST_DATABASE_URL;
if (!connectionString) throw new Error("Use a disposable LIGHTTICK_TEST_DATABASE_URL");
await runPostgresMigrations({ connectionString, log:()=>undefined });
const pool = new Pool({ connectionString, max:6 });
after(()=>pool.end());

import { LightTickGoalService } from "../../src/modules/lighttick/lighttick-goal.service.ts";
import { LightTickPlanService } from "../../src/modules/lighttick/lighttick-plan.service.ts";
import { LightTickPlanningService } from "../../src/modules/lighttick/planning/planning.service.ts";
import { LightTickAiRunner } from "../../src/modules/lighttick/ai/lighttick-ai-runner.ts";
const owner={appId:"lighttick" as const,userId:"planning-test"};
const clock=()=>new Date("2026-09-13T00:00:00Z");
async function setup() {
  const repository=new PostgresLightTickRepository(pool);
  await repository.deleteOwnerData(owner);
  const goal=await new LightTickGoalService(repository,clock).create(owner,{title:"做一个可运行的示例",constraints:{weekly_available_minutes:30}});
  const service=new LightTickPlanningService(repository,clock);
  const created=await service.command(owner,"create","create",undefined,{goal_id:goal.id});
  const ready=await service.command(owner,"context","context",created.session.id,{base_version:created.session.version,fields:{period_start:{value:"2026-09-13",source:"user"},period_end:{value:"2026-09-19",source:"confirmed"}}});
  return {repository,goal,service,session:ready.session};
}
function runner(repository: PostgresLightTickRepository, output: any = {tasks:[{title:"运行示例并保存结果",estimated_minutes:10}]}) {
  return new LightTickAiRunner(repository,{complete:async()=>{ if(output instanceof Error) throw output; return {provider:"fake",providerModel:"fake",text:JSON.stringify(output),usage:{totalTokens:10}}; }} as any,clock);
}
async function draft(f:Awaited<ReturnType<typeof setup>>,key="generate",instruction?:string) {
  const session=await f.service.get(owner,f.session.id);
  return await f.service.command(owner,key,"drafts",session.id,{base_version:session.version,context_revision:session.contextRevision,deep_planning:true,...(instruction?{instruction}:{})});
}
async function confirmInput(f:Awaited<ReturnType<typeof setup>>) {
  const session=await f.service.get(owner,f.session.id); const plan=await f.repository.getPlan(owner,session.draftPlanId!);
  return {base_version:session.version,context_revision:session.contextRevision,draft_plan_id:session.draftPlanId,plan_version:plan!.version};
}
test("session creation is replayable, isolated, and keeps explicit provenance",async()=>{
  const f=await setup(); const replay=await f.service.command(owner,"create","create",undefined,{goal_id:f.goal.id});
  assert.equal(replay.session.id,f.session.id); assert.equal(f.session.context.objective?.source,"imported");
  assert.equal(f.session.context.period_end?.source,"confirmed"); assert.equal(f.session.status,"ready");
  await assert.rejects(f.service.get({...owner,userId:"other"},f.session.id),{code:"LIGHTTICK_RESOURCE_NOT_FOUND"});
  await assert.rejects(f.service.command(owner,"create","create",undefined,{goal_id:"other"}),{code:"LIGHTTICK_IDEMPOTENCY_MISMATCH"});
});
test("clarification extracts only assumptions and never replaces confirmed facts",async()=>{
  const f=await setup(); const started=await f.service.command(owner,"message","messages",f.session.id,{base_version:f.session.version,message:"我想做一个网页，能投入120分钟"});
  await runner(f.repository,{message:"请确认想要的成果。",fields:{outcome:"一个网页",available_minutes:120}}).execute(owner,started.run!.id,"planning_clarify");
  const current=await f.service.get(owner,f.session.id);
  assert.equal(current.context.available_minutes?.value,30); assert.equal(current.context.outcome?.source,"assumption");
  assert.ok(current.context.outcome?.source_message_id); assert.equal((await f.repository.listPlans(owner)).length,0);
});
test("context patch uses CAS and rejects injected sources, fields and invalid dates",async()=>{
  const f=await setup();
  await assert.rejects(f.service.command(owner,"badver","context",f.session.id,{base_version:1,fields:{}}),{code:"LIGHTTICK_VERSION_CONFLICT"});
  for(const [key,value,source] of [["available_minutes",0,"user"],["period_end","2026-02-30","user"],["admin",true,"user"],["outcome","anything","imported"]])
    await assert.rejects(f.service.command(owner,String(key)+String(source),"context",f.session.id,{base_version:f.session.version,fields:{[key as string]:{value,source}}}),{code:"REQ_FIELD_INVALID"});
});
test("explicit deep planning gate and only one active run",async()=>{
  const f=await setup();
  await assert.rejects(f.service.command(owner,"no-gate","drafts",f.session.id,{base_version:f.session.version,context_revision:f.session.contextRevision}),{code:"LIGHTTICK_STATE_TRANSITION_INVALID"});
  const started=await draft(f); const current=await f.service.get(owner,f.session.id);
  await assert.rejects(f.service.command(owner,"second","drafts",f.session.id,{base_version:current.version,context_revision:current.contextRevision,deep_planning:true}),{code:"LIGHTTICK_PLANNING_BUSY"});
  assert.equal((await f.service.command(owner,"generate","drafts",f.session.id,{base_version:f.session.version,context_revision:f.session.contextRevision,deep_planning:true})).run!.id,started.run!.id);
});
test("draft adjustment supersedes the old draft and explicit confirmation is atomic and replayable",async()=>{
  const f=await setup(); let run=await draft(f); await runner(f.repository).execute(owner,run.run!.id,"week_plan");
  const old=await confirmInput(f); run=await draft(f,"adjust","换成五分钟的练习");
  await runner(f.repository,{tasks:[{title:"运行一个小示例",estimated_minutes:5}]}).execute(owner,run.run!.id,"week_plan");
  await assert.rejects(new LightTickPlanService(f.repository,clock).confirm(owner,old.draft_plan_id!,old.plan_version),{code:"LIGHTTICK_PLANNING_STALE"});
  const input=await confirmInput(f);
  const results=await Promise.all([f.service.command(owner,"confirm","confirm",f.session.id,input),f.service.command(owner,"confirm","confirm",f.session.id,input)]);
  assert.deepEqual(JSON.parse(JSON.stringify(results[0])),JSON.parse(JSON.stringify(results[1]))); assert.equal(results[0].session.status,"confirmed");
  assert.equal((await f.repository.listTasks(owner)).length,1); assert.equal((await f.repository.listTasks(owner))[0].estimatedMinutes,5);
});
test("context modification during provider execution discards stale output",async()=>{
  const f=await setup(); const started=await draft(f); let release!:()=>void; let entered!:()=>void;
  const signal=new Promise<void>(r=>entered=r); const held=new Promise<void>(r=>release=r);
  const ai=new LightTickAiRunner(f.repository,{complete:async()=>{entered();await held;return {provider:"fake",providerModel:"fake",text:JSON.stringify({tasks:[{title:"old",estimated_minutes:10}]})};}} as any,clock);
  const running=ai.execute(owner,started.run!.id,"week_plan"); await signal;
  const current=await f.service.get(owner,f.session.id);
  await f.service.command(owner,"revise","context",current.id,{base_version:current.version,fields:{available_minutes:{value:5,source:"confirmed"}}});
  release(); assert.equal((await running).errorCode,"LIGHTTICK_PLANNING_STALE");
  assert.equal((await f.repository.listPlans(owner)).length,0); assert.equal((await f.service.get(owner,current.id)).activeRunId,undefined);
});
test("provider failure preserves input and exposes safe retry without a fake draft",async()=>{
  const f=await setup(); const started=await draft(f);
  assert.equal((await runner(f.repository,new Error("private provider failure")).execute(owner,started.run!.id,"week_plan")).status,"failed");
  const current=await f.service.get(owner,f.session.id); assert.equal(current.status,"ready");assert.equal(current.lastError,"LIGHTTICK_AI_UNAVAILABLE");
  assert.deepEqual(current.context,f.session.context); assert.equal((await f.repository.listPlans(owner)).length,0);
  const retry=await draft(f,"retry");await runner(f.repository).execute(owner,retry.run!.id,"week_plan");
  assert.equal((await f.service.get(owner,f.session.id)).status,"draft_ready");
});
test("a write failure rolls back confirmation, and the same operation can retry",async()=>{
  const f=await setup();const started=await draft(f);await runner(f.repository).execute(owner,started.run!.id,"week_plan");const input=await confirmInput(f);
  const save=f.repository.saveTask.bind(f.repository);f.repository.saveTask=async()=>{throw new Error("disk");};
  await assert.rejects(f.service.command(owner,"confirm","confirm",f.session.id,input),/disk/);
  assert.equal((await f.repository.getPlan(owner,input.draft_plan_id!))!.status,"proposed");assert.equal((await f.repository.listTasks(owner)).length,0);
  assert.equal((await f.service.get(owner,f.session.id)).status,"draft_ready");
  f.repository.saveTask=save;assert.equal((await f.service.command(owner,"confirm","confirm",f.session.id,input)).session.status,"confirmed");
});
test("active-plan or goal changes invalidate confirmation",async()=>{
  const f=await setup();const started=await draft(f);await runner(f.repository).execute(owner,started.run!.id,"week_plan");const input=await confirmInput(f);
  await new LightTickGoalService(f.repository,clock).update(owner,f.goal.id,f.goal.version,{title:"changed"});
  await assert.rejects(f.service.command(owner,"confirm","confirm",f.session.id,input),{code:"LIGHTTICK_VERSION_CONFLICT"});
});
test("deleting an owner removes sessions and in-flight results cannot resurrect them",async()=>{
  const f=await setup();const started=await draft(f);await f.repository.deleteOwnerData(owner);
  await assert.rejects(f.service.get(owner,f.session.id),{code:"LIGHTTICK_RESOURCE_NOT_FOUND"});
  await assert.rejects(runner(f.repository).execute(owner,started.run!.id,"week_plan"),{code:"LIGHTTICK_RESOURCE_NOT_FOUND"});
});
test("additive session migration preserves legacy goals and persists across repository recreation",async()=>{
  const f=await setup();
  const before=await f.repository.getGoal(owner,f.goal.id);
  await runPostgresMigrations({connectionString,log:()=>undefined});
  const fresh=new PostgresLightTickRepository(pool);
  assert.deepEqual(await fresh.getGoal(owner,f.goal.id),before);
  assert.equal((await fresh.getPlanningSession(owner,f.session.id))!.contextRevision,2);
  const installed=await pool.query("SELECT name FROM zook_schema_migrations WHERE name='060_lighttick_planning_sessions.sql'");
  assert.equal(installed.rowCount,1);
});
