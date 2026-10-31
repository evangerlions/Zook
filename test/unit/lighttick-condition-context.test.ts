import test from 'node:test';import assert from 'node:assert/strict';
import {InMemoryLightTickRepository} from '../../src/testing/in-memory-lighttick-repository.ts';
import {LightTickGoalService} from '../../src/modules/lighttick/lighttick-goal.service.ts';
import {GoalConditionsService} from '../../src/modules/lighttick/goal-context/goal-conditions.service.ts';
import {assembleLightTickContext,assembleChatContext} from '../../src/modules/lighttick/ai/lighttick-ai-context.ts';
test('implicit model context contains only applicable confirmed budgets, never private condition reasons or raw audit history',async()=>{
 const r=new InMemoryLightTickRepository(),owner={appId:'lighttick',userId:'private-condition-owner'} as const,clock=()=>new Date('2026-10-31T00:00:00Z');
 const g=await new LightTickGoalService(r,clock).create(owner,{title:'Learn',constraints:{}}),s=new GoalConditionsService(r,clock);
 await s.confirm(owner,g.id,'context-ongoing-key',{id:'condition-one',base_version:1,condition_version:0,scope:'ongoing',starts_on:'2026-10-01',ends_on:null,daily_minutes:20,active:true,reason:'PRIVATE CONDITION REASON'});
 await s.confirm(owner,g.id,'context-temporary-key',{id:'condition-temp',base_version:2,condition_version:0,scope:'temporary',starts_on:'2026-10-31',ends_on:'2026-10-31',daily_minutes:5,active:true,reason:'PRIVATE TEMPORARY EXPLANATION'});
 const input={goal_id:g.id,period_start:'2026-11-01',period_end:'2026-11-01'};
 for(const result of [await assembleLightTickContext(r,owner,input),await assembleChatContext(r,owner,input,'new-thread')]){
  const serialized=JSON.stringify(result);assert.equal(serialized.includes('PRIVATE'),false);assert.equal(serialized.includes('confirmed_planning_conditions'),false);
  assert.equal((result.goal!.constraints as any).confirmed_daily_limits[0].minutes,20);
 }
});
