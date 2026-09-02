import assert from "node:assert/strict";
import test from "node:test";
import { LightTickProposalService } from "../../src/modules/lighttick/lighttick-proposal.service.ts";
import { LightTickPlanService } from "../../src/modules/lighttick/lighttick-plan.service.ts";
import { LightTickTaskService } from "../../src/modules/lighttick/lighttick-task.service.ts";
import type { LightTickExecutionEventRow, LightTickOwner } from "../../src/modules/lighttick/lighttick.types.ts";
import { InMemoryLightTickRepository } from "../../src/testing/in-memory-lighttick-repository.ts";
import { LightTickGoalService } from "../../src/modules/lighttick/lighttick-goal.service.ts";

const owner: LightTickOwner = { appId: "lighttick", userId: "user_prop" };
const now = "2026-09-01T00:00:00.000Z";
const clock = () => new Date(now);

function event(occurredAt: string, eventType: string, title: string, lineage: string,
  payload: Record<string, unknown> = {}): LightTickExecutionEventRow {
  const action = eventType === "task_skipped" ? "skip" : eventType === "task_completed" ? "complete" : eventType.replace("task_", "");
  return { id: `evt-${occurredAt}-${eventType}-${lineage}`, ...owner, aggregateType: "task",
    aggregateId: `task-${lineage}`, eventType, aggregateVersion: 1, occurredAt, createdAt: occurredAt,
    payload: { action, title, lineage_id: lineage, ...payload } };
}

function lineageOf(task: { id: string; lineageId?: string }): string {
  return task.lineageId ?? task.id;
}

async function setupGoalWithActiveWeekPlan(repository: InMemoryLightTickRepository) {
  const goal = await new LightTickGoalService(repository, clock).create(owner, { title: "备考", constraints: {} });
  const plan = await new LightTickPlanService(repository, clock).createProposed(owner, {
    goalId: goal.id, granularity: "week", periodStart: "2026-08-31", periodEnd: "2026-09-06",
    source: "test", tasks: [
      { title: "背单词", estimatedMinutes: 20, priority: 1 },
      { title: "练习", estimatedMinutes: 15, priority: 2 },
    ], metadata: {} });
  const confirmed = await new LightTickPlanService(repository, clock).confirm(owner, plan.id, plan.version);
  return { goal, plan: confirmed.plan, tasks: confirmed.tasks };
}

function skipEvents(days: number[], title: string, lineage: string) {
  return days.map(day => event(`2026-08-${String(day).padStart(2, "0")}T02:00:00.000Z`, "task_skipped", title, lineage,
    { reason: "no_time" }));
}

test("consecutive skips produce a cancel proposal with evidence", async () => {
  const repository = new InMemoryLightTickRepository();
  const { goal, plan, tasks } = await setupGoalWithActiveWeekPlan(repository);
  const words = tasks.find(task => task.title === "背单词")!;
  for (const item of skipEvents([31, 30, 29], "背单词", lineageOf(words))) repository.events.push(item);
  const service = new LightTickProposalService(repository, clock);
  const result = await service.proposeFromFacts(owner, goal.id);
  assert.equal(result.suppressed, undefined);
  assert.equal(result.proposals.length, 1);
  const proposal = result.proposals[0]!;
  assert.equal(proposal.status, "pending");
  assert.equal(proposal.planId, plan.id);
  assert.ok(proposal.diff.some((diff: any) => diff.action === "cancel_task" && diff.task_id === words.id));
  assert.match(proposal.reason, /连续/);
  assert.equal((proposal.impact as any).source, "from_facts");
  assert.equal((proposal.impact as any).rule_id, "hypothesis.consecutive_skips");
});

test("a pending proposal suppresses a duplicate", async () => {
  const repository = new InMemoryLightTickRepository();
  const { goal, tasks } = await setupGoalWithActiveWeekPlan(repository);
  const words = tasks.find(task => task.title === "背单词")!;
  for (const item of skipEvents([31, 30, 29], "背单词", lineageOf(words))) repository.events.push(item);
  const service = new LightTickProposalService(repository, clock);
  await service.proposeFromFacts(owner, goal.id);
  const second = await service.proposeFromFacts(owner, goal.id);
  assert.deepEqual(second, { proposals: [], suppressed: "duplicate_pending" });
});

test("three rejections in a week dampen proactivity", async () => {
  const repository = new InMemoryLightTickRepository();
  const { goal, plan, tasks } = await setupGoalWithActiveWeekPlan(repository);
  const words = tasks.find(task => task.title === "背单词")!;
  for (const item of skipEvents([31, 30, 29], "背单词", lineageOf(words))) repository.events.push(item);
  const service = new LightTickProposalService(repository, clock);
  for (let index = 0; index < 3; index += 1) {
    const proposal = await service.proposeFromFacts(owner, goal.id);
    assert.equal(proposal.suppressed, undefined);
    assert.equal(proposal.proposals.length, 1);
    await service.reject(owner, proposal.proposals[0]!.id, proposal.proposals[0]!.version);
    const pending = (await repository.listProposals(owner, plan.id)).find(item => item.status === "pending");
    if (pending) await repository.saveProposal({ ...pending, status: "expired", decidedAt: now, updatedAt: now }, pending.version);
  }
  const dampened = await service.proposeFromFacts(owner, goal.id);
  assert.equal(dampened.suppressed, "rejection_dampening");
});

test("estimation bias over thirty percent proposes a duration fix", async () => {
  const repository = new InMemoryLightTickRepository();
  const { goal, tasks } = await setupGoalWithActiveWeekPlan(repository);
  const practice = tasks.find(task => task.title === "练习")!;
  for (let day = 26; day <= 31; day += 1) {
    repository.events.push(event(`2026-08-${day}T02:00:00.000Z`, "task_completed", "练习", lineageOf(practice),
      { actual_minutes: 30, estimated_minutes: 15, valid_action: true }));
  }
  const service = new LightTickProposalService(repository, clock);
  const result = await service.proposeFromFacts(owner, goal.id);
  assert.equal(result.proposals.length, 1);
  const update = result.proposals[0]!.diff.find((diff: any) => diff.action === "update_task");
  assert.ok(update);
  assert.ok((update as any).estimated_minutes > 15);
});

test("no trigger facts produce no proposal", async () => {
  const repository = new InMemoryLightTickRepository();
  const { goal } = await setupGoalWithActiveWeekPlan(repository);
  const service = new LightTickProposalService(repository, clock);
  const result = await service.proposeFromFacts(owner, goal.id);
  assert.deepEqual(result, { proposals: [] });
});

test("accepted from-facts proposal replans through the normal pipeline", async () => {
  const repository = new InMemoryLightTickRepository();
  const { goal, plan, tasks } = await setupGoalWithActiveWeekPlan(repository);
  const words = tasks.find(task => task.title === "背单词")!;
  for (const item of skipEvents([31, 30, 29], "背单词", lineageOf(words))) repository.events.push(item);
  const service = new LightTickProposalService(repository, clock);
  const result = await service.proposeFromFacts(owner, goal.id);
  const proposal = result.proposals[0]!;
  const accepted = await service.accept(owner, proposal.id, proposal.version);
  assert.equal(accepted.proposal.status, "accepted");
  assert.equal(accepted.plan.status, "active");
  assert.notEqual(accepted.plan.id, plan.id);
  const remaining = (await repository.listTasks(owner, accepted.plan.id))
    .filter(task => task.status === "pending" && task.title === "背单词");
  assert.equal(remaining.length, 0);
});
