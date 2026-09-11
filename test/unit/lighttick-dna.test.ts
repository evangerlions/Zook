import assert from "node:assert/strict";
import test from "node:test";
import { LightTickDnaService } from "../../src/modules/lighttick/lighttick-dna.service.ts";
import type { LightTickExecutionEventRow, LightTickOwner } from "../../src/modules/lighttick/lighttick.types.ts";
import { InMemoryLightTickRepository } from "../../src/testing/in-memory-lighttick-repository.ts";

const owner: LightTickOwner = { appId: "lighttick", userId: "user_dna" };
const now = "2026-09-01T00:00:00.000Z";

function completionEvent(occurredAt: string, actualMinutes: number, estimatedMinutes: number,
  title = "晨读", lineage = "lineage-read"): LightTickExecutionEventRow {
  return { id: `evt-${occurredAt}-${actualMinutes}`, ...owner, aggregateType: "task", aggregateId: "task-1",
    eventType: "task_completed", aggregateVersion: 1, occurredAt, createdAt: occurredAt,
    payload: { action: "complete", actual_minutes: actualMinutes, estimated_minutes: estimatedMinutes,
      valid_action: true, title, lineage_id: lineage } };
}

async function seedCompletions(repository: InMemoryLightTickRepository, count: number, actual = 25, estimated = 15) {
  for (let index = 0; index < count; index += 1) {
    const day = String(index + 1).padStart(2, "0");
    repository.events.push(completionEvent(`2026-09-${day}T02:00:00.000Z`, actual, estimated));
  }
}

test("synchronize promotes a rule after seven stable completions with signature dedupe", async () => {
  const repository = new InMemoryLightTickRepository();
  await seedCompletions(repository, 7, 16, 15);
  const dna = new LightTickDnaService(repository, () => new Date(now));
  const first = await dna.synchronize(owner);
  const bias = first.find(insight => insight.ruleId === "rule.time_estimation_bias");
  assert.ok(bias);
  assert.equal(bias.kind, "rule");
  assert.equal(bias.status, "proposed");
  assert.equal(bias.evidenceCount, 7);
  assert.deepEqual(bias.allowedEffects, []);
  assert.ok(bias.confidence >= 0.7);
  const second = await dna.synchronize(owner);
  assert.equal(second.filter(insight => insight.ruleId === "rule.time_estimation_bias").length, 1);
  assert.equal((await dna.list(owner)).filter(insight => insight.ruleId === "rule.time_estimation_bias").length, 1);
});

test("three events only produce a low-confidence hypothesis", async () => {
  const repository = new InMemoryLightTickRepository();
  await seedCompletions(repository, 3, 30, 15);
  const dna = new LightTickDnaService(repository, () => new Date(now));
  const insights = await dna.synchronize(owner);
  const hypothesis = insights.find(insight => insight.ruleId === "hypothesis.time_estimation_bias");
  assert.ok(hypothesis);
  assert.equal(hypothesis.kind, "hypothesis");
  assert.ok(hypothesis.confidence < 0.7);
});

test("low-confidence hypothesis cannot be confirmed into effects", async () => {
  const repository = new InMemoryLightTickRepository();
  await seedCompletions(repository, 3, 30, 15);
  const dna = new LightTickDnaService(repository, () => new Date(now));
  const insights = await dna.synchronize(owner);
  const hypothesis = insights.find(insight => insight.ruleId === "hypothesis.time_estimation_bias")!;
  await assert.rejects(() => dna.feedback(owner, hypothesis.id, "confirm"),
    (error: any) => error.code === "LIGHTTICK_INSIGHT_NOT_ACTIONABLE");
});

test("user confirm on a rule grants allowed effects and locks the insight", async () => {
  const repository = new InMemoryLightTickRepository();
  await seedCompletions(repository, 7, 16, 15);
  const dna = new LightTickDnaService(repository, () => new Date(now));
  const insights = await dna.synchronize(owner);
  const rule = insights.find(insight => insight.ruleId === "rule.time_estimation_bias")!;
  const confirmed = await dna.feedback(owner, rule.id, "confirm");
  assert.equal(confirmed.status, "confirmed");
  assert.deepEqual(confirmed.allowedEffects, ["scheduling", "variant", "recovery"]);
  await assert.rejects(() => dna.feedback(owner, rule.id, "deny"),
    (error: any) => error.code === "LIGHTTICK_STATE_TRANSITION_INVALID");
});

test("denied insights are retired and never resurrected by synchronize", async () => {
  const repository = new InMemoryLightTickRepository();
  await seedCompletions(repository, 7, 16, 15);
  const dna = new LightTickDnaService(repository, () => new Date(now));
  const rule = (await dna.synchronize(owner)).find(insight => insight.ruleId === "rule.time_estimation_bias")!;
  await dna.feedback(owner, rule.id, "deny");
  const after = await dna.synchronize(owner);
  assert.equal(after.some(insight => insight.ruleId === "rule.time_estimation_bias"), false);
  assert.equal((await dna.list(owner)).some(insight => insight.ruleId === "rule.time_estimation_bias"
    && insight.status === "denied"), true);
});

test("correct records the user's alternative statement and retires the insight", async () => {
  const repository = new InMemoryLightTickRepository();
  await seedCompletions(repository, 7, 16, 15);
  const dna = new LightTickDnaService(repository, () => new Date(now));
  const rule = (await dna.synchronize(owner)).find(insight => insight.ruleId === "rule.time_estimation_bias")!;
  const corrected = await dna.feedback(owner, rule.id, "correct", "我其实下午效率更高");
  assert.equal(corrected.status, "corrected");
  assert.equal(corrected.userFeedback, "我其实下午效率更高");
});

test("time slot hypothesis is scoped to time_slot", async () => {
  const repository = new InMemoryLightTickRepository();
  await seedCompletions(repository, 3, 20, 20);
  const dna = new LightTickDnaService(repository, () => new Date(now));
  const insights = await dna.synchronize(owner);
  const slot = insights.find(insight => insight.ruleId === "hypothesis.best_slot");
  assert.ok(slot);
  assert.equal(slot.scope, "time_slot");
});

test("feedback validates missing correction text", async () => {
  const repository = new InMemoryLightTickRepository();
  await seedCompletions(repository, 3, 30, 15);
  const dna = new LightTickDnaService(repository, () => new Date(now));
  const insights = await dna.synchronize(owner);
  const hypothesis = insights.find(insight => insight.ruleId === "hypothesis.time_estimation_bias")!;
  await assert.rejects(() => dna.feedback(owner, hypothesis.id, "correct", " "),
    (error: any) => error.code === "REQ_FIELD_INVALID");
});

test("synchronize is timezone aware through the profile", async () => {
  const repository = new InMemoryLightTickRepository();
  await repository.saveProfile({ ...owner, id: "profile-1", timezone: "America/Los_Angeles", locale: "en-US",
    pace: "balanced", onboardingState: "committed", notificationPreferences: {}, onboardingDraft: {},
    version: 1, createdAt: now, updatedAt: now });
  await seedCompletions(repository, 3, 20, 20);
  const dna = new LightTickDnaService(repository, () => new Date(now));
  const insights = await dna.synchronize(owner);
  const slot = insights.find(insight => insight.ruleId === "hypothesis.best_slot");
  assert.ok(slot);
  assert.equal(slot.scope, "time_slot");
});

test("insights belong to the owner and never leak across users", async () => {
  const repository = new InMemoryLightTickRepository();
  await seedCompletions(repository, 3, 30, 15);
  const dna = new LightTickDnaService(repository, () => new Date(now));
  await dna.synchronize(owner);
  const other = await dna.list({ appId: "lighttick", userId: "someone_else" });
  assert.equal(other.length, 0);
});
