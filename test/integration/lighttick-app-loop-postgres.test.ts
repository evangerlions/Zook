import assert from 'node:assert/strict';
import test from 'node:test';
import { Pool } from 'pg';
import { PostgresLightTickRepository } from '../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts';
import { runPostgresMigrations } from '../../src/infrastructure/database/postgres/migrate.ts';
import { LightTickGoalService } from '../../src/modules/lighttick/lighttick-goal.service.ts';
import { LightTickPlanService } from '../../src/modules/lighttick/lighttick-plan.service.ts';
import { LightTickTaskService } from '../../src/modules/lighttick/lighttick-task.service.ts';
import { LightTickReviewService } from '../../src/modules/lighttick/lighttick-review.service.ts';
import { LightTickTodayService } from '../../src/modules/lighttick/lighttick-today.service.ts';
const connectionString=process.env.LIGHTTICK_TEST_DATABASE_URL;
if(!connectionString)throw new Error('A disposable LIGHTTICK_TEST_DATABASE_URL is required');
test('rich plan confirmation, steps and local-day review survive database reconnect and migration replay',async()=>{
 await runPostgresMigrations({connectionString,log:()=>{}});const pool=new Pool({connectionString});
 const owner={appId:'lighttick' as const,userId:'app-loop-pg'};const clock=()=>new Date('2026-09-20T02:00:00Z');
 const repo=new PostgresLightTickRepository(pool);await repo.deleteOwnerData(owner);
 try{
 const goal=await new LightTickGoalService(repo,clock).create(owner,{title:'改善汇报',constraints:{}});
 await repo.saveProfile({...owner,timezone:'America/Los_Angeles',locale:'zh-CN',pace:'balanced',onboardingState:'completed',notificationPreferences:{},onboardingDraft:{},version:1,createdAt:clock().toISOString(),updatedAt:clock().toISOString()});
 const plans=new LightTickPlanService(repo,clock);const p=await plans.createProposed(owner,{goalId:goal.id,granularity:'day',periodStart:'2026-09-19',periodEnd:'2026-09-19',source:'ai',tasks:[{title:'写事实清单',estimatedMinutes:10,scheduledFor:'2026-09-19',completionCriteria:'写三个事实',guidance:{purpose:'区分事实和假设',materials:['项目资料'],expected_output:'事实清单'},steps:['读资料','写清单']}]});
 const attempts=await Promise.allSettled([plans.confirm(owner,p.id,1),plans.confirm(owner,p.id,1)]);assert.equal(attempts.filter(r=>r.status==='fulfilled').length,1);
 const reconnected=new PostgresLightTickRepository(pool);const tasks=await reconnected.listTasks(owner,p.id);assert.equal(tasks.length,1);assert.equal(tasks[0].guidance?.expected_output,'事实清单');assert.equal(tasks[0].completionCriteria,'写三个事实');assert.equal((await reconnected.listTaskSteps(owner,tasks[0].id)).length,2);
 assert.equal(tasks[0].scheduledFor,'2026-09-19');
 assert.equal((await reconnected.getPlan(owner,p.id))?.periodEnd,'2026-09-19');
 assert.equal((await new LightTickTodayService(reconnected,clock).get(owner)).primaryTask?.id,tasks[0].id);
 await new LightTickTaskService(reconnected,clock).command(owner,tasks[0].id,tasks[0].version,{action:'complete',actualMinutes:8});
 const unscheduled=await plans.createProposed(owner,{goalId:goal.id,granularity:'day',periodStart:'2026-09-19',periodEnd:'2026-09-19',source:'test',tasks:[{title:'当天未指定时刻任务',estimatedMinutes:5}]});
 const unscheduledResult=await plans.confirm(owner,unscheduled.id,1);
 assert.ok((await new LightTickTodayService(reconnected,clock).get(owner)).executableTasks.some(t=>t.id===unscheduledResult.tasks[0].id));
 const r=await new LightTickReviewService(reconnected,clock).create(owner,goal.id,'day','2026-09-19','2026-09-19');assert.equal(r.periodStart,'2026-09-19');assert.equal(r.dataSufficiency,'sufficient');assert.equal((r.facts.tasks as any[])[0].actual_minutes,8);
 await runPostgresMigrations({connectionString,log:()=>{}});assert.equal((await repo.getTask(owner,tasks[0].id))?.guidance?.purpose,'区分事实和假设');assert.equal((await repo.listReviews(owner))[0].period,'day');
 }finally{await repo.deleteOwnerData(owner);await pool.end();}
});
