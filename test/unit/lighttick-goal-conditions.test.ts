import test from 'node:test';
import assert from 'node:assert/strict';
import { GoalConditionsService } from '../../src/modules/lighttick/goal-context/goal-conditions.service.ts';
import { LightTickGoalService } from '../../src/modules/lighttick/lighttick-goal.service.ts';
import { InMemoryLightTickRepository } from '../../src/testing/in-memory-lighttick-repository.ts';
const owner={appId:'lighttick',userId:'condition-owner'} as const;
const now=()=>new Date('2026-10-31T04:00:00Z');
test('reviewed conditions keep durable receipts, versions and ownership while preserving existing work',async()=>{
 const r=new InMemoryLightTickRepository(),goals=new LightTickGoalService(r,now),s=new GoalConditionsService(r,now),g=await goals.create(owner,{title:'Learn',constraints:{}});
 const input={id:'condition-one',base_version:g.version,condition_version:0,scope:'ongoing',starts_on:'2026-10-31',ends_on:null,daily_minutes:20,active:true,reason:'My confirmed daily capacity'};
 const saved=await s.confirm(owner,g.id,'condition-first-key',input);
 assert.equal(saved.goal.version,2);assert.equal(saved.condition.daily_minutes,20);assert.deepEqual(await s.confirm(owner,g.id,'condition-first-key',input),saved);
 assert.equal((await r.listTasks(owner)).length,0);assert.equal((await s.context(owner,g.id,'2026-11-01','2026-11-01')).daily_limits[0].minutes,20);
 await assert.rejects(s.confirm({...owner,userId:'bob'},g.id,'condition-second-key',input),{statusCode:404});
 await assert.rejects(s.confirm(owner,g.id,'condition-second-key',input),{statusCode:409});
 await assert.rejects(goals.update(owner,g.id,2,{constraints:{weekly_available_minutes:500}}),{statusCode:422});
 await assert.rejects(goals.create(owner,{title:'Forged',constraints:saved.goal.constraints}),{statusCode:422});
});
