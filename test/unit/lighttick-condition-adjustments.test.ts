import assert from "node:assert/strict";
import test from "node:test";
import { conditionHistory, conditionRevision, conditionsValue } from "../../src/modules/lighttick/goal-context/confirmed-conditions.ts";
import { readConditionAdjustments } from "../../src/modules/lighttick/goal-context/condition-adjustments.ts";
import { manualConditionsRequireReview } from "../../src/modules/lighttick/manual/manual-condition-basis.ts";
import type { LightTickGoalRow, LightTickPlanRow, LightTickTaskRow } from "../../src/modules/lighttick/lighttick.types.ts";

const owner = { appId: "lighttick", userId: "alice" };
const created = "2026-11-20T17:00:00.000Z";
const saved = "2026-11-23T05:00:00.000Z";
const goal: LightTickGoalRow = { ...owner, id: "goal-current", title: "Practice a presentation", status: "active",
  version: 1, constraints: {}, createdAt: created, updatedAt: created };
const plan: LightTickPlanRow = { ...owner, id: "plan-current", goalId: goal.id, status: "active", periodStart: "2026-11-21",
  periodEnd: "2026-11-26", granularity: "week", source: "manual_native", proposal: {},
  createdAt: created, updatedAt: created, version: 1 };
const change = conditionRevision(goal, { id: "cond-brief", condition_version: 0, base_version: 1, scope: "ongoing",
  starts_on: "2026-11-23", ends_on: null, daily_minutes: 20, active: true, reason: "Shorter practice on weekdays" }, saved);
const current: LightTickGoalRow = { ...goal, version: 2, updatedAt: saved,
  constraints: { confirmed_planning_conditions: conditionsValue(goal, change) } };

function task(id: string, data: Partial<LightTickTaskRow> = {}): LightTickTaskRow {
  return { ...owner, id, planId: plan.id, goalId: goal.id, title: id, status: "pending", priority: 1,
    estimatedMinutes: 15, scheduledFor: "2026-11-24", createdAt: created, updatedAt: created, version: 1, ...data };
}

test("condition adjustment derives remaining current work from saved limits and open plan rows", () => {
  const today = "2026-11-23";
  const zone = "Asia/Shanghai";
  const finished = task("completed-history", { status: "completed", scheduledFor: "2026-11-25", actualMinutes: 29 });
  const first = task("first-task");
  const second = task("second-task", { scheduledFor: "2026-11-23T18:00:00.000Z" });
  const past = task("older-task", { scheduledFor: "2026-11-22", estimatedMinutes: 60 });
  const idle = task("out-of-scope", { goalId: "goal-other", estimatedMinutes: 90 });
  const estimateMissing = task("needs-estimate", { scheduledFor: "2026-11-26", estimatedMinutes: null });
  const tasks = [finished, first, second, past, idle, estimateMissing];
  assert.deepEqual(readConditionAdjustments([current], [plan], tasks, today, zone), [{ goal_id: goal.id,
    goal_title: goal.title, task_count: 3, starts_on: "2026-11-24", ends_on: "2026-11-26" }]);
  assert.deepEqual(readConditionAdjustments([current], [plan], [finished, first, { ...second, scheduledFor: today },
    past, idle, { ...estimateMissing, estimatedMinutes: 20 }], today, zone), []);
  assert.equal(conditionHistory(current).length, 1);
});

test("preexisting drafts require review only if a saved condition changed within their period", () => {
  const proposal = { ...plan, status: "proposed" as const };
  const draft = { title: "Existing draft", completion_criteria: "", period_start: "2026-11-23", period_end: "2026-11-26", tasks: [] };
  assert.equal(manualConditionsRequireReview(current, proposal, draft), true);
  assert.equal(manualConditionsRequireReview(current, { ...proposal, updatedAt: "2026-11-23T05:01:00.000Z" }, draft), false);
  assert.equal(manualConditionsRequireReview(current, proposal, { ...draft, period_start: "2026-11-21", period_end: "2026-11-22" }), false);
});
