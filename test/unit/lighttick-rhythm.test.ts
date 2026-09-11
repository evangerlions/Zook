import assert from "node:assert/strict";
import test from "node:test";
import { LightTickRhythmSuggestionService } from "../../src/modules/lighttick/lighttick-rhythm.service.ts";
import { LightTickDnaService } from "../../src/modules/lighttick/lighttick-dna.service.ts";
import { LightTickPlanService } from "../../src/modules/lighttick/lighttick-plan.service.ts";
import type { LightTickExecutionEventRow, LightTickOwner } from "../../src/modules/lighttick/lighttick.types.ts";
import { InMemoryLightTickRepository } from "../../src/testing/in-memory-lighttick-repository.ts";
import { LightTickGoalService } from "../../src/modules/lighttick/lighttick-goal.service.ts";

const owner: LightTickOwner = { appId: "lighttick", userId: "user_rhythm" };
const clock = () => new Date("2026-09-02T01:00:00.000Z");
const BUSINESS = "2026-09-02";

for (const actual of [10, 20]) {
  test(`rhythm respects actual ${actual} versus estimated 20 minutes`, async () => {
    const repository = new InMemoryLightTickRepository();
    const { task } = await goalWithActivePlan(repository);
    for (let day = 1; day <= 7; day++) {
      const current = (await repository.getTask(owner, task.id))!;
      await repository.saveTask(current, {
        event: completion(`2026-08-${20 + day}T02:00:00.000Z`, actual, 20, task.title, task.lineageId ?? task.id),
        change: { ...owner, entityType: "task", entityId: task.id, entityVersion: current.version + 1,
          operation: "upsert", snapshot: {}, changedAt: clock().toISOString() },
      }, current.version);
    }
    const dna = new LightTickDnaService(repository, clock);
    const insight = (await dna.synchronize(owner)).find(item => item.kind === "rule")!;
    await dna.feedback(owner, insight.id, "confirm");
    const result = await new LightTickRhythmSuggestionService(repository, dna, clock).suggest(owner);
    if (actual < 20) assert.match(result.suggestion?.action ?? "", /下调/);
    else assert.equal(result.suggestion, undefined);
  });
}

function completion(occurredAt: string, actual: number, estimated: number,
  title: string, lineage: string): LightTickExecutionEventRow {
  return { id: `e-${occurredAt}-${lineage}`, ...owner, aggregateType: "task", aggregateId: lineage,
    eventType: "task_completed", aggregateVersion: 1, occurredAt, createdAt: occurredAt,
    payload: { action: "complete", actual_minutes: actual, estimated_minutes: estimated,
      valid_action: true, title, lineage_id: lineage } };
}

async function goalWithActivePlan(repository: InMemoryLightTickRepository) {
  const goal = await new LightTickGoalService(repository, clock).create(owner, { title: "考试", constraints: {} });
  const plan = await new LightTickPlanService(repository, clock).createProposed(owner, {
    goalId: goal.id, granularity: "week", periodStart: "2026-08-31", periodEnd: "2026-09-06",
    source: "test", tasks: [{ title: "背单词", estimatedMinutes: 20, priority: 1 }], metadata: {} });
  const confirmed = await new LightTickPlanService(repository, clock).confirm(owner, plan.id, plan.version);
  return { goal, task: confirmed.tasks[0]! };
}

async function confirmedBiasInsight(repository: InMemoryLightTickRepository, taskId: string) {
  // 7 completions of the same lineage produce a rule; confirm it.
  for (let day = 26; day <= 31; day += 1) {
    repository.events.push(completion(`2026-08-${day}T02:00:00.000Z`, 35, 20, "背单词", taskId));
  }
  repository.events.push(completion("2026-09-01T02:00:00.000Z", 35, 20, "背单词", taskId));
  const dna = new LightTickDnaService(repository, clock);
  const promoted = (await dna.synchronize(owner)).find(insight => insight.ruleId === "rule.time_estimation_bias")!;
  return await dna.feedback(owner, promoted.id, "confirm");
}

test("confirmed estimation insight yields exactly one suggestion for today", async () => {
  const repository = new InMemoryLightTickRepository();
  const { task } = await goalWithActivePlan(repository);
  await confirmedBiasInsight(repository, task.lineageId ?? task.id);
  const result = await new LightTickRhythmSuggestionService(repository).suggest(owner);
  assert.ok(result.suggestion);
  assert.equal(result.suggestion.ruleId, "rule.time_estimation_bias");
  assert.equal(result.suggestion.task.id, task.id);
  assert.match(result.suggestion.action, /低估/);
});

test("no confirmed insight yields no suggestion with a clear reason", async () => {
  const repository = new InMemoryLightTickRepository();
  await goalWithActivePlan(repository);
  const result = await new LightTickRhythmSuggestionService(repository).suggest(owner);
  assert.equal(result.reason, "no_confirmed_insight");
  assert.equal(result.suggestion, undefined);
});

test("unconfirmed (hypothesis-only) insights never speak into today", async () => {
  const repository = new InMemoryLightTickRepository();
  const { task } = await goalWithActivePlan(repository);
  const lineage = task.lineageId ?? task.id;
  for (let day = 29; day <= 31; day += 1) repository.events.push(completion(`2026-08-${day}T02:00:00.000Z`, 35, 20, "背单词", lineage));
  const dna = new LightTickDnaService(repository, clock);
  await dna.synchronize(owner);
  const result = await new LightTickRhythmSuggestionService(repository).suggest(owner);
  assert.equal(result.suggestion, undefined);
  assert.equal(result.reason, "no_confirmed_insight");
});

test("dismiss retires the suggestion without judging the insight", async () => {
  const repository = new InMemoryLightTickRepository();
  const { task } = await goalWithActivePlan(repository);
  const insight = await confirmedBiasInsight(repository, task.lineageId ?? task.id);
  const service = new LightTickRhythmSuggestionService(repository);
  const dismissed = await service.feedback(owner, insight.id, "dismiss");
  assert.equal(dismissed.status, "dismissed");
  const after = await service.suggest(owner);
  assert.equal(after.suggestion, undefined);
  assert.equal(after.reason, "no_confirmed_insight");
});

test("accept records intent and keeps the insight active", async () => {
  const repository = new InMemoryLightTickRepository();
  const { task } = await goalWithActivePlan(repository);
  const insight = await confirmedBiasInsight(repository, task.lineageId ?? task.id);
  const service = new LightTickRhythmSuggestionService(repository);
  const accepted = await service.feedback(owner, insight.id, "accept");
  assert.equal(accepted.status, "confirmed");
  assert.equal(accepted.userFeedback, "accepted_for_today");
});

test("no executable tasks today yields no suggestion", async () => {
  const repository = new InMemoryLightTickRepository();
  const goal = await new LightTickGoalService(repository, clock).create(owner, { title: "考试", constraints: {} });
  const result = await new LightTickRhythmSuggestionService(repository).suggest(owner);
  assert.equal(result.reason, "no_today_tasks");
});
