import assert from "node:assert/strict";
import test from "node:test";
import { LIGHTTICK_AI_SCENES } from "../../src/modules/lighttick/ai/lighttick-ai-scenes.ts";
import { prepareLearningGeneration, validateLearningGeneration } from "../../src/modules/lighttick/learning/learning-work-generation.ts";
import type { LearningWork } from "../../src/modules/lighttick/learning/learning-work.types.ts";

const replacement = [
  { id: "reviewed-task-one", version: 3 },
  { id: "reviewed-task-two", version: 2 },
];
const rows = [
  { lesson_number: 1, purpose: "learn", scheduled_for: "2026-11-25", estimated_minutes: 12 },
  { lesson_number: 2, purpose: "learn", scheduled_for: "2026-11-26", estimated_minutes: 10 },
];
const now = "2026-11-23T01:00:00.000Z";
const work: LearningWork = {
  appId: "lighttick", userId: "user-schedule", id: "work-schedule-test", routeId: "plan-a", kind: "schedule_draft",
  status: "running", revision: 2, epoch: 1, baseRouteRevision: 3, fence: "fence", attempt: 1, output: null,
  reservedMicros: 250000, errorCode: null, leaseUntil: "2026-11-23T01:01:00.000Z", createdAt: now, updatedAt: now,
  input: { consent_revision: 1, schedule: {
    options: { route_id: "plan-a", route_version: 1, goal_id: "goal-schedule", goal_base_version: 2,
      available_daily_minutes: 30, available_weekly_minutes: 120, period_start: "2026-11-24", period_end: "2026-11-28",
      replace_tasks: replacement },
    selected: rows.map((row, i) => ({ ...row, source_task_id: replacement[i]?.id })),
    modelInput: { catalog: rows, editing_selected_tasks: true, business_date: "2026-11-23" },
  } },
};
const prepared = prepareLearningGeneration(work, [], LIGHTTICK_AI_SCENES.learning_schedule);
function result(items: unknown[], finishReason = "stop") {
  return validateLearningGeneration(prepared, {
    text: JSON.stringify({ items }), provider: "fixture", providerModel: "schedule-fixture", finishReason,
  });
}

test("AI receives schedule choices without owner fields and cannot change source task identity", () => {
  const prompt = prepared.request.messages[1].content;
  assert.equal(typeof prompt, "string");
  assert.match(prompt as string, /editing_selected_tasks/);
  assert.doesNotMatch(prompt as string, /reviewed-task-one|user-schedule|consent_revision|source_task_id/);
  assert.deepEqual((result(rows).suggestion as { items: { source_task_id: string }[] }).items
    .map(item => item.source_task_id), replacement.map(item => item.id));
});

test("AI suggestions reject partial adjustments, duplicates and forged tasks", () => {
  assert.throws(() => result([rows[0]]), /exactly once/);
  assert.throws(() => result([rows[0], rows[0]]), /exactly once/);
  assert.throws(() => result([rows[0], { ...rows[1], lesson_number: 3 }]), /reviewed course/);
  assert.throws(() => result([rows[0], { ...rows[1], source_task_id: "forged" }]), /valid schedule suggestion/);
  assert.throws(() => result(rows, "length"), /truncated/);
});

test("AI may recommend keeping the schedule", () => {
  const output = result([]);
  assert.equal(output.no_change, true);
  assert.equal(output.suggestion, undefined);
});
