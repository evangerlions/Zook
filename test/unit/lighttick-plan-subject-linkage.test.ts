import assert from "node:assert/strict";
import test from "node:test";
import { LightTickAiRunner } from "../../src/modules/lighttick/ai/lighttick-ai-runner.ts";
import { LightTickGoalService } from "../../src/modules/lighttick/lighttick-goal.service.ts";
import { LightTickTodayService } from "../../src/modules/lighttick/lighttick-today.service.ts";
import { ManualPlanningService } from "../../src/modules/lighttick/manual/manual-planning.service.ts";
import type { ManualDraft } from "../../src/modules/lighttick/manual/manual-planning.types.ts";
import { LightTickPlanningService } from "../../src/modules/lighttick/planning/planning.service.ts";
import { InMemoryLightTickRepository } from "../../src/testing/in-memory-lighttick-repository.ts";
import { saveGoalSubjectFixture } from "../support/lighttick-subject-plan-fixture.ts";

const owner = { appId: "lighttick", userId: "subject-linkage-account" } as const;
const clock = () => new Date("2026-11-02T12:00:00Z");
const day = "2026-11-02";
const subjects = [
  { id: "writing", title: "结构化表达", outcome_criteria: "先说清楚结论", priority: "high", weekly_minutes: 20, archived: false,
    latest_outcome: { note: "私有反馈不得给模型", recorded_at: "2026-11-01T09:00:00Z" } },
  { id: "speaking", title: "表达练习", outcome_criteria: "两分钟内说清楚", priority: "normal", weekly_minutes: null, archived: false,
    latest_outcome: null },
] as const;

async function setup() {
  const repository = new InMemoryLightTickRepository();
  const goals = new LightTickGoalService(repository, clock);
  const goal = await goals.create(owner, { title: "表达准确", constraints: { completion_criteria: "完成目标原成果" } });
  await saveGoalSubjectFixture(repository, goal, subjects, clock().toISOString());
  const today = new LightTickTodayService(repository, clock);
  const manual = new ManualPlanningService(repository, clock);
  const planning = new LightTickPlanningService(repository, clock);
  const example = (subjectId?: string, title = "做一次练习", date = day): ManualDraft => ({
    goal_id: goal.id, ...(subjectId ? { subject_id: subjectId } : {}), title, completion_criteria: "保存一次练习",
    period_start: date, period_end: date, tasks: [{ id: "exercise", title, completion_criteria: title, guidance: "",
      scheduled_for: date, estimated_minutes: 10 }],
  });
  const confirm = async (plan: Awaited<ReturnType<typeof manual.create>>, key: string) =>
    manual.confirm(owner, plan.id, key, { base_version: plan.version, goal_base_version: plan.goal_version });
  return { repository, goals, goal, today, manual, planning, example, confirm };
}

test("manual edits preserve an omitted subject, an explicit null clears it, and archival keeps confirmed actions", async () => {
  const { repository, goals, goal, today, manual, example, confirm } = await setup();
  const otherGoal = await goals.create(owner, { title: "独立目标", constraints: {} });
  await assert.rejects(manual.create(owner, "missing-subject", { ...example("writing"), goal_id: otherGoal.id }),
    { code: "LIGHTTICK_PLANNING_SUBJECT_UNAVAILABLE" });
  const writing = await manual.create(owner, "first-writing", example("writing"));
  const untouched = await manual.update(owner, writing.id, "old-client", { ...example(), base_version: writing.version });
  assert.equal(untouched.draft.subject_id, "writing");
  assert.equal((await repository.getPlan(owner, writing.id))?.proposal.subject_id, "writing");
  const activeWriting = await confirm(untouched, "confirm-writing");
  const detachedDraft = await manual.create(owner, "explicit-detach", example("writing", "仅保留新草稿"));
  const detached = await manual.update(owner, detachedDraft.id, "remove-subject", { ...example(undefined, "仅保留新草稿"),
    subject_id: null, base_version: detachedDraft.version });
  assert.equal(detached.draft.subject_id, undefined);
  const speaking = await manual.create(owner, "same-title-other-subject", example("speaking"));
  await confirm(speaking, "confirm-speaking");
  const currentGoal = (await repository.getGoal(owner, goal.id))!;
  await saveGoalSubjectFixture(repository, currentGoal,
    subjects.map(subject => ({ ...subject, archived: subject.id === "writing" })), clock().toISOString());
  await assert.rejects(manual.create(owner, "archived-subject", example("writing")), { code: "LIGHTTICK_PLANNING_SUBJECT_UNAVAILABLE" });
  await assert.rejects(manual.get({ ...owner, userId: "different-account" }, activeWriting.id),
    { code: "LIGHTTICK_RESOURCE_NOT_FOUND" });
  assert.equal((await today.get(owner)).executableTasks.length, 2);
  assert.deepEqual((await today.get(owner)).cycleHandoffs?.map(handoff => handoff.subjectId), ["speaking"]);
  assert.equal((await repository.getGoal(owner, goal.id))?.constraints.completion_criteria, "完成目标原成果");
});

test("manual transfers inherit the reviewed source subject, preserve lineage, and reject mismatched sources", async () => {
  const { repository, manual, example, confirm } = await setup();
  const active = await confirm(await manual.create(owner, "before-transfer", example("writing")), "confirm-original");
  const original = (await repository.listTasks(owner, active.id))[0]!;
  const replacement = { ...example(undefined, "把练习分两次完成"),
    replace_tasks: [{ id: original.id, version: original.version }] };
  await assert.rejects(manual.create(owner, "wrong-subject", { ...replacement, subject_id: "speaking" }),
    { code: "LIGHTTICK_PLAN_CONSTRAINT_FAILED" });
  const draft = await manual.create(owner, "subject-from-original", replacement);
  assert.equal(draft.draft.subject_id, "writing");
  const confirmed = await confirm(draft, "confirm-carried");
  const carried = (await repository.listTasks(owner, confirmed.id))[0]!;
  assert.equal(carried.lineageId, original.lineageId ?? original.id);
  assert.equal((await repository.getPlan(owner, confirmed.id))?.proposal.subject_id, "writing");
  assert.equal((await repository.getTask(owner, original.id))?.status, "cancelled");
});

test("subject AI sessions isolate history and prompt evidence, and confirm work into Today with the original scope", async () => {
  const { repository, goal, today, manual, planning, example, confirm } = await setup();
  await confirm(await manual.create(owner, "other-subject-plan", example("speaking", "其他科目的私人题目")), "confirm-other");
  const create = async (subjectId: string) => (await planning.command(owner, "subject-" + subjectId, "create",
    undefined, { goal_id: goal.id, subject_id: subjectId })).session;
  const writing = await create("writing");
  await create("speaking");
  assert.equal((await planning.list(owner, "1", goal.id, undefined, "writing"))[0]?.id, writing.id);
  assert.deepEqual(await planning.list({ ...owner, userId: "different-account" }, "1", goal.id, undefined, "writing"), []);
  assert.equal(writing.context.available_minutes?.value, 20);
  const draft = await planning.command(owner, "draft", "drafts", writing.id, {
    base_version: writing.version, context_revision: writing.contextRevision, deep_planning: true,
  });
  let prompt = "";
  const worker = new LightTickAiRunner(repository, { complete: async (input: any) => {
    prompt = JSON.stringify(input.messages);
    return { provider: "local-test", providerModel: "local-test",
      text: JSON.stringify({ tasks: [{ title: "两句话写下结论", estimated_minutes: 10, scheduled_for: day }] }) };
  } } as any, clock);
  const result = await worker.execute(owner, draft.run!.id, "week_plan");
  assert.equal(result.status, "succeeded");
  assert.match(prompt, /结构化表达/);
  assert.match(prompt, /先说清楚结论/);
  assert.doesNotMatch(prompt, /私有反馈不得给模型|其他科目的私人题目|planning_subject_id/);
  const ready = await planning.get(owner, writing.id);
  const plan = (await repository.getPlan(owner, ready.draftPlanId!))!;
  assert.equal(plan.proposal.subject_id, "writing");
  assert.equal((await today.get(owner)).executableTasks.length, 1);
  const approved = await planning.command(owner, "approve", "confirm", ready.id, {
    base_version: ready.version, context_revision: ready.contextRevision, draft_plan_id: plan.id, plan_version: plan.version,
  });
  assert.equal(approved.session.status, "confirmed");
  assert.equal((await today.get(owner)).executableTasks.find(task => task.title === "两句话写下结论")?.planId, plan.id);
  const follow = (await planning.command(owner, "follow-subject", "create", undefined,
    { goal_id: goal.id, previous_plan_id: plan.id })).session;
  assert.equal(follow.subjectId, "writing");
  await assert.rejects(planning.command(owner, "wrong-follow-subject", "create", undefined,
    { goal_id: goal.id, previous_plan_id: plan.id, subject_id: "speaking" }), { code: "LIGHTTICK_PLANNING_SUBJECT_UNAVAILABLE" });
});
