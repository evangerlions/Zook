import assert from 'node:assert/strict';
import test from 'node:test';
import { InMemoryLightTickRepository } from '../../src/testing/in-memory-lighttick-repository.ts';
import { LightTickReflectionService } from '../../src/modules/lighttick/lighttick-reflection.service.ts';
import { LightTickGoalService } from '../../src/modules/lighttick/lighttick-goal.service.ts';
import { LightTickPlanService } from '../../src/modules/lighttick/lighttick-plan.service.ts';
import { LightTickReviewService } from '../../src/modules/lighttick/lighttick-review.service.ts';
import { LightTickTaskService } from '../../src/modules/lighttick/lighttick-task.service.ts';
import { assembleLightTickContext } from '../../src/modules/lighttick/ai/lighttick-ai-context.ts';
const owner={appId:'lighttick' as const,userId:'journal-owner'};
const other={...owner,userId:'other'};
const clock=()=>new Date('2026-09-19T12:00:00Z');
async function setup(){const repo=new InMemoryLightTickRepository();const goal=await new LightTickGoalService(repo,clock).create(owner,{title:'学习与生活规划',constraints:{}});return {repo,goal};}
test('journal persists without AI, lost-response replay, CAS conflict, isolation, privacy and deletion',async()=>{
 const {repo,goal}=await setup();const service=new LightTickReflectionService(repo,clock);
 const input={goal_id:goal.id,period_start:'2026-09-19',period_end:'2026-09-19',content:'私人复盘原文',next_action:'明天练习十分钟',base_version:0};
 const first=await service.save(owner,'reflection-001',input);assert.equal(first.version,1);
 assert.deepEqual(await service.save(owner,'reflection-001',input),first);
 const results=await Promise.allSettled(['修改一','修改二'].map(content=>service.save(owner,first.id,{...input,content,base_version:1})));
 assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
 assert.equal((await service.list(owner,goal.id))[0].version,2);
 assert.equal((await repo.listReflections(other)).length,0);
 await assert.rejects(service.save(other,first.id,input),{code:'LIGHTTICK_RESOURCE_NOT_FOUND'});
 await assert.rejects(service.save(owner,'reflection-invalid',{...input,period_end:'2026-02-30'}));
 const context=await assembleLightTickContext(repo,owner,{goal_id:goal.id});assert.ok(!JSON.stringify(context).includes('私人复盘'));
 await repo.deleteOwnerData(owner);assert.equal((await repo.listReflections(owner)).length,0);
});
test('whole-plan review filters sibling tasks and independent analyses keep earlier results',async()=>{
 const {repo,goal}=await setup();const plans=new LightTickPlanService(repo,clock);
 const make=async(title:string)=>{const p=await plans.createProposed(owner,{goalId:goal.id,granularity:'week',periodStart:'2026-09-19',periodEnd:'2026-09-25',source:'test',tasks:[{title,estimatedMinutes:10,scheduledFor:'2026-09-19'}]});return plans.confirm(owner,p.id,1);};
 const a=await make('英语练习');const b=await make('阅读笔记');
 for(const p of [a,b])await new LightTickTaskService(repo,clock).command(owner,p.tasks[0].id,1,{action:'complete'});
 const reviews=new LightTickReviewService(repo,clock);
 const r=await reviews.create(owner,goal.id,'week','2026-09-19','2026-09-25',{planId:a.plan.id,fresh:true});
 assert.equal(r.facts.event_count,1);assert.equal((r.facts.planned_tasks as any[]).length,1);
 const r2=await reviews.create(owner,goal.id,'week','2026-09-19','2026-09-25',{planId:a.plan.id,fresh:true});assert.notEqual(r.id,r2.id);
 await assert.rejects(reviews.create(owner,goal.id,'week','2026-09-18','2026-09-25',{planId:a.plan.id}));
 const otherGoal=await new LightTickGoalService(repo,clock).create(owner,{title:'另一个目标',constraints:{}});
 await assert.rejects(reviews.create(owner,otherGoal.id,'week','2026-09-19','2026-09-25',{planId:a.plan.id}));
});
test('concurrent overlapping plans do not duplicate tasks, while repeated practice across days remains valid',async()=>{
 const {repo,goal}=await setup();const plans=new LightTickPlanService(repo,clock);
 const input={goalId:goal.id,granularity:'week' as const,periodStart:'2026-09-19',periodEnd:'2026-09-25',source:'test',tasks:[{title:'Read Chapter',estimatedMinutes:10,scheduledFor:'2026-09-19'}]};
 const a=await plans.createProposed(owner,input);const b=await plans.createProposed(owner,{...input,tasks:[{...input.tasks[0],title:'  read   chapter  '}]});
 const result=await Promise.allSettled([plans.confirm(owner,a.id,1),plans.confirm(owner,b.id,1)]);assert.equal(result.filter(r=>r.status==='fulfilled').length,1);assert.equal((await repo.listTasks(owner)).length,1);
 const c=await plans.createProposed(owner,{...input,tasks:[{...input.tasks[0],scheduledFor:'2026-09-20'}]});await plans.confirm(owner,c.id,1);assert.equal((await repo.listTasks(owner)).length,2);
});
