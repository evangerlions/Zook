import test from 'node:test';
import assert from 'node:assert/strict';
import { conditionRevision, effectiveDailyLimits, assertDailyCapacity } from '../../src/modules/lighttick/goal-context/confirmed-conditions.ts';
import type { LightTickGoalRow } from '../../src/modules/lighttick/lighttick.types.ts';
const goal = (revisions: unknown[] = []): LightTickGoalRow => ({ appId: 'lighttick', userId: 'alice', id: 'g', title: 'Learn', status: 'active', version: 8, constraints: { confirmed_planning_conditions: { schema_version: 1, revisions } }, createdAt: '2026-10-01T00:00:00Z', updatedAt: '2026-10-31T00:00:00Z' });
const entry = (overrides: Record<string, unknown> = {}) => ({ id: 'condition-one', revision: 1, sequence: 2, scope: 'ongoing', starts_on: '2026-10-01', ends_on: null, daily_minutes: 30, active: true, reason: 'Confirmed available time', confirmed_at: '2026-10-01T00:00:00Z', ...overrides });

test('ongoing corrections apply to the next window and temporary constraints expire', () => {
 const g = goal([entry(), entry({ revision: 2, sequence: 3, daily_minutes: 20 }), entry({ id: 'temporary-one', sequence: 4, scope: 'temporary', starts_on: '2026-10-31', ends_on: '2026-11-01', daily_minutes: 10 })]);
 assert.deepEqual(effectiveDailyLimits(g, '2026-10-31', '2026-11-02').map(v => [v.date, v.minutes, v.condition_id, v.condition_version]), [['2026-10-31',10,'temporary-one',1],['2026-11-01',10,'temporary-one',1],['2026-11-02',20,'condition-one',2]]);
});
test('revoking the latest ongoing condition never resurrects an older budget', () => {
 const g = goal([entry(), entry({ id: 'condition-two', sequence: 4, daily_minutes: 15 }), entry({ id: 'condition-two', revision: 2, sequence: 5, active: false, daily_minutes: null })]);
 assert.equal(effectiveDailyLimits(g, '2026-11-01','2026-11-01')[0].minutes, null);
});
test('revoking a temporary condition restores the applicable ongoing decision, not an older temporary one', () => {
 const g = goal([entry(),entry({id:'temp-one',sequence:3,scope:'temporary',starts_on:'2026-11-01',ends_on:'2026-11-03',daily_minutes:5}),entry({id:'temp-two',sequence:4,scope:'temporary',starts_on:'2026-11-01',ends_on:'2026-11-03',daily_minutes:10}),entry({id:'temp-two',revision:2,sequence:5,scope:'temporary',starts_on:'2026-11-01',ends_on:'2026-11-03',daily_minutes:null,active:false})]);
 assert.equal(effectiveDailyLimits(g,'2026-11-02','2026-11-02')[0].minutes,30);
});
test('confirmation requires the current goal and condition versions and valid explicit windows', () => {
 const g = goal([entry()]);
 const input = { id: 'condition-one', condition_version: 1, base_version:8, scope:'ongoing', starts_on:'2026-11-01', ends_on:null, daily_minutes:12, active:true, reason:'Less time' };
 assert.equal(conditionRevision(g,input,'2026-10-31T00:00:00Z').revision,2);
 for(const patch of [{base_version:7},{condition_version:0},{scope:'temporary'},{daily_minutes:0},{starts_on:'2026-02-30'},{reason:''}]) assert.throws(()=>conditionRevision(g,{...input,...patch},'2026-10-31T00:00:00Z'));
 assert.throws(()=>conditionRevision(goal([entry(),entry({id:'newer',sequence:6})]),input,'2026-10-31T00:00:00Z'));
});
test('capacity preserves existing work, excludes only explicitly replaced tasks, and never invents unknown effort', () => {
 const g=goal([entry({daily_minutes:20})]);
 const existing=[{id:'old',goalId:'g',status:'pending',scheduledFor:'2026-11-01T00:00:00+08:00',estimatedMinutes:15}];
 const proposed=[{scheduled_for:'2026-11-01',estimated_minutes:10}];
 assert.throws(()=>assertDailyCapacity(g,'2026-11-01','2026-11-01',proposed,existing,new Set(),'Asia/Shanghai'));
 assert.doesNotThrow(()=>assertDailyCapacity(g,'2026-11-01','2026-11-01',proposed,existing,new Set(['old']),'Asia/Shanghai'));
 const result=assertDailyCapacity(g,'2026-11-01','2026-11-01',[{scheduled_for:'2026-11-01',estimated_minutes:null}],[],new Set(),'Asia/Shanghai');
 assert.equal(result[0].unknown_count,1);assert.equal(result[0].known_minutes,0);assert.equal(result[0].minutes,20);
 assert.equal(existing[0].status,'pending');
});
test('future or malformed stored condition schemas fail closed',()=>{
 const g=goal();g.constraints.confirmed_planning_conditions={schema_version:2,revisions:[]};assert.throws(()=>effectiveDailyLimits(g,'2026-11-01','2026-11-01'));
 assert.throws(()=>effectiveDailyLimits(goal([entry({daily_minutes:-3})]),'2026-11-01','2026-11-01'));
});
test('invalidation cannot narrow its old window and expose superseded budgets',()=>{
 const g=goal([entry(),entry({id:'temp-old',sequence:3,scope:'temporary',starts_on:'2026-11-01',ends_on:'2026-11-03',daily_minutes:5}),entry({id:'temp-new',sequence:4,scope:'temporary',starts_on:'2026-11-01',ends_on:'2026-11-03',daily_minutes:10})]);
 assert.throws(()=>conditionRevision(g,{id:'temp-new',condition_version:1,base_version:8,scope:'temporary',starts_on:'2026-11-02',ends_on:'2026-11-02',daily_minutes:null,active:false,reason:'No longer applies'},'2026-10-31T00:00:00Z'));
});
test('ambiguous duplicate revisions and non-string timestamps are rejected',()=>{
 for(const values of [[entry(),entry({daily_minutes:12})],[entry({confirmed_at:1})]])assert.throws(()=>effectiveDailyLimits(goal(values),'2026-11-01','2026-11-01'));
});
test('a replacement list cannot erase already completed effort',()=>{
 assert.throws(()=>assertDailyCapacity(goal([entry({daily_minutes:20})]),'2026-11-01','2026-11-01',[{scheduled_for:'2026-11-01',estimated_minutes:20}],[{id:'done',goalId:'g',status:'completed',scheduledFor:'2026-11-01',estimatedMinutes:15}],new Set(['done']),'UTC'));
});
