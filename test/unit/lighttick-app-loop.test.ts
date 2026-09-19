import assert from 'node:assert/strict';
import test from 'node:test';
import { InMemoryLightTickRepository } from '../../src/testing/in-memory-lighttick-repository.ts';
import { LightTickGoalService } from '../../src/modules/lighttick/lighttick-goal.service.ts';
import { LightTickPlanService } from '../../src/modules/lighttick/lighttick-plan.service.ts';
import { LightTickTaskService } from '../../src/modules/lighttick/lighttick-task.service.ts';
import { LightTickReviewService } from '../../src/modules/lighttick/lighttick-review.service.ts';
import { LightTickTodayService } from '../../src/modules/lighttick/lighttick-today.service.ts';
import { assembleLightTickContext } from '../../src/modules/lighttick/ai/lighttick-ai-context.ts';
const owner={appId:'lighttick' as const,userId:'loop-user'};
const clock=()=>new Date('2026-09-20T02:00:00Z');
async function setup(){const repo=new InMemoryLightTickRepository(); const goal=await new LightTickGoalService(repo,clock).create(owner,{title:'改善汇报',constraints:{}});return {repo,goal,plans:new LightTickPlanService(repo,clock)};}
test('reviewable task details survive confirmation into executable Today steps',async()=>{
 const {repo,goal,plans}=await setup();
 const draft=await plans.createProposed(owner,{goalId:goal.id,granularity:'week',source:'ai',periodStart:'2026-09-20',periodEnd:'2026-09-26',tasks:[{title:'比较两个方案',estimatedMinutes:20,scheduledFor:'2026-09-20',completionCriteria:'提交两方案表',steps:['列出事实','比较收益和风险'],guidance:{purpose:'训练证据推理',materials:['自己的项目记录'],expected_output:'两方案表'}}]});
 assert.equal((await repo.listTasks(owner)).length,0);
 const saved=await plans.confirm(owner,draft.id,draft.version); const task=saved.tasks[0];
 assert.equal(task.completionCriteria,'提交两方案表');assert.equal(task.guidance?.purpose,'训练证据推理');
 assert.deepEqual((await repo.listTaskSteps(owner,task.id)).map(s=>s.title),['列出事实','比较收益和风险']);
 assert.equal((await new LightTickTodayService(repo,clock).get(owner)).primaryTask?.id,task.id);
 await assert.rejects(plans.confirm(owner,draft.id,draft.version));assert.equal((await repo.listTasks(owner)).length,1);
});
test('daily review uses only this goal and local-day execution facts, with unknown actual duration preserved',async()=>{
 const {repo,goal,plans}=await setup(); const other=await new LightTickGoalService(repo,clock).create(owner,{title:'另一目标',constraints:{}});
 await repo.saveProfile({...owner,timezone:'America/Los_Angeles',locale:'zh-CN',pace:'balanced',onboardingState:'completed',notificationPreferences:{},onboardingDraft:{},version:1,createdAt:clock().toISOString(),updatedAt:clock().toISOString()});
 for(const g of [goal,other]){const p=await plans.createProposed(owner,{goalId:g.id,granularity:'week',source:'ai',periodStart:'2026-09-19',periodEnd:'2026-09-25',tasks:[{title:g.title,estimatedMinutes:10,scheduledFor:'2026-09-19'}]}); const saved=await plans.confirm(owner,p.id,p.version);await new LightTickTaskService(repo,clock).command(owner,saved.tasks[0].id,1,{action:'complete',notes:'私人备注不可隐式进入AI'});}
 const review=await new LightTickReviewService(repo,clock).create(owner,goal.id,'day','2026-09-19','2026-09-19');
 assert.equal(review.dataSufficiency,'sufficient');assert.equal((review.facts.event_counts as any).task_complete,1);
 assert.equal((review.facts.tasks as any[]).length,1);assert.equal((review.facts.tasks as any[])[0].actual_minutes,null);
 assert.ok(!JSON.stringify(review.facts).includes('私人备注'));
 const context=await assembleLightTickContext(repo,owner,{goal_id:goal.id,review_id:review.id});assert.equal(context.review?.id,review.id);
 await assert.rejects(assembleLightTickContext(repo,owner,{goal_id:other.id,review_id:review.id}),{code:'LIGHTTICK_PLAN_CONSTRAINT_FAILED'});
 await assert.rejects(new LightTickReviewService(repo,clock).create(owner,goal.id,'day','2026-02-30','2026-02-30'));
});
test('date-only tasks keep their business date west of UTC',async()=>{
 const {repo,goal,plans}=await setup();await repo.saveProfile({...owner,timezone:'America/Los_Angeles',locale:'en',pace:'balanced',onboardingState:'completed',notificationPreferences:{},onboardingDraft:{},version:1,createdAt:clock().toISOString(),updatedAt:clock().toISOString()});
 const p=await plans.createProposed(owner,{goalId:goal.id,granularity:'day',source:'ai',periodStart:'2026-09-19',periodEnd:'2026-09-19',tasks:[{title:'今天任务',estimatedMinutes:10,scheduledFor:'2026-09-19'}]});await plans.confirm(owner,p.id,p.version);
 assert.equal((await new LightTickTodayService(repo,clock).get(owner)).primaryTask?.title,'今天任务');
});
test('confirming a future plan keeps today visible; completing the goal hides its work',async()=>{
 const {repo,goal,plans}=await setup();
 for (const [date,title] of [['2026-09-20','今天'],['2026-09-27','下周']]) {const p=await plans.createProposed(owner,{goalId:goal.id,granularity:'week',source:'ai',periodStart:date,periodEnd:date,tasks:[{title,estimatedMinutes:10,scheduledFor:date}]});await plans.confirm(owner,p.id,p.version);}
 assert.equal((await new LightTickTodayService(repo,clock).get(owner)).primaryTask?.title,'今天');
 const current=await repo.getGoal(owner,goal.id);await new LightTickGoalService(repo,clock).transition(owner,goal.id,current!.version,'complete');
 assert.equal((await new LightTickTodayService(repo,clock).get(owner)).executableTasks.length,0);
});
test('a new review request after an action decision does not reuse or reopen that decision',async()=>{
 const {repo,goal}=await setup();const reviews=new LightTickReviewService(repo,clock);
 const first=await reviews.create(owner,goal.id,'day','2026-09-20','2026-09-20');
 await repo.saveReview({...first,output:{action_state:{status:'ignored'}},version:first.version+1});
 const next=await reviews.create(owner,goal.id,'day','2026-09-20','2026-09-20');assert.notEqual(next.id,first.id);
 assert.equal((await reviews.create(owner,goal.id,'day','2026-09-20','2026-09-20')).id,next.id);
 assert.equal((await repo.listReviews(owner)).find(r=>r.id===first.id)?.output.action_state.status,'ignored');
});
