import assert from "node:assert/strict";
import test from "node:test";
import { LightTickGoalService } from "../../src/modules/lighttick/lighttick-goal.service.ts";
import { LightTickTaskService } from "../../src/modules/lighttick/lighttick-task.service.ts";
import { LightTickReflectionService } from "../../src/modules/lighttick/lighttick-reflection.service.ts";
import { ManualPlanningService } from "../../src/modules/lighttick/manual/manual-planning.service.ts";
import { InMemoryLightTickRepository } from "../../src/testing/in-memory-lighttick-repository.ts";

const owner = { appId: "lighttick", userId: "continuation-owner" } as const;
const clock = () => new Date("2026-10-31T04:00:00.000Z");
const action = (id: string, title = id) => ({ id, title, scheduled_for: "2026-11-01",
  estimated_minutes: 10, completion_criteria: "One concrete example", guidance: "" });
const draftInput = (tasks = [action("initial-one"), action("initial-two"), action("initial-three")]) => ({
  title: "Practice clear explanations", completion_criteria: "Explain one concrete example",
  period_start: "2026-11-01", period_end: "2026-11-07", tasks,
});

async function fixture() {
  const repository = new InMemoryLightTickRepository();
  const manual = new ManualPlanningService(repository, clock);
  const goals = new LightTickGoalService(repository, clock);
  const tasks = new LightTickTaskService(repository, clock);
  const reflections = new LightTickReflectionService(repository, clock);
  const draft = await manual.create(owner, "initial-create", draftInput());
  const plan = await manual.confirm(owner, draft.id, "initial-confirm", {
    base_version: draft.version, goal_base_version: draft.goal_version,
  });
  const existing = await repository.listTasks(owner);
  const reflectionInput = { goal_id: plan.goal_id, plan_id: plan.id, period_start: "2026-10-31",
    period_end: "2026-10-31", content: "A smaller example was easier to explain.",
    next_action: "Review a smaller example tomorrow", base_version: 0 };
  const reflection = await reflections.save(owner, "reflection-source", reflectionInput);
  const continuation = (patch: Record<string, unknown> = {}) => ({ ...draftInput([action("reviewed-next", "Reviewed next arrangement")]),
    goal_id: plan.goal_id, source_reflection_id: reflection.id, source_reflection_version: reflection.version,
    ...patch } as any);
  const confirm = async (id: string, key: string) => {
    const reviewed = await manual.get(owner, id);
    const goal = await goals.get(owner, reviewed.goal_id);
    return manual.confirm(owner, id, key, { base_version: reviewed.version, goal_base_version: goal.version });
  };
  return { repository, manual, goals, tasks, reflections, plan, existing, reflection, reflectionInput, continuation, confirm };
}

async function snapshot(repository: InMemoryLightTickRepository) {
  return { goals: await repository.listGoals(owner), plans: await repository.listPlans(owner),
    tasks: await repository.listTasks(owner), reflections: await repository.listReflections(owner),
    events: await repository.listExecutionEvents(owner), changes: await repository.pullChanges(owner, 0, 1000) };
}
const rejectedReview = (error: any) => [404, 409, 422].includes(error.statusCode);

test("saving reflection content and next_action never creates an arrangement", async () => {
  const repository = new InMemoryLightTickRepository();
  const goal = await new LightTickGoalService(repository, clock).create(owner, { title: "Reflect first", constraints: {} });
  const reflections = new LightTickReflectionService(repository, clock);
  const input = { goal_id: goal.id, period_start: "2026-10-31", period_end: "2026-10-31",
    content: "One useful observation", next_action: "A suggested next action", base_version: 0 };
  const first = await reflections.save(owner, "inert-reflection", input);
  await reflections.save(owner, first.id, { ...input, base_version: first.version, next_action: "Revised suggestion" });
  assert.deepEqual(await repository.listTasks(owner), []);
  assert.deepEqual(await repository.listPlans(owner), []);
  assert.equal((await repository.getGoal(owner, goal.id))?.status, "draft");
});

test("reviewing a continuation retains its selected reflection revision and creates no tasks", async () => {
  const { repository, manual, reflection, continuation } = await fixture();
  const before = await repository.listTasks(owner);
  const draft = await manual.create(owner, "source-review-create", continuation());
  assert.deepEqual(await repository.listTasks(owner), before);
  assert.equal(draft.status, "proposed");
  assert.equal((draft.draft as any).source_reflection_id, reflection.id);
  assert.equal((draft.draft as any).source_reflection_version, reflection.version);
});

test("confirmation materializes exactly the reviewed next arrangement and receipt retry is inert", async () => {
  const { repository, manual, reflection, continuation, confirm } = await fixture();
  const beforePlans = (await repository.listPlans(owner)).length;
  const beforeTasks = (await repository.listTasks(owner)).length;
  const draft = await manual.create(owner, "source-confirm-create", continuation());
  const command = { base_version: draft.version, goal_base_version: draft.goal_version };
  const first = await confirm(draft.id, "source-confirm-command");
  const after = await snapshot(repository);
  const replay = await new ManualPlanningService(repository, clock).confirm(owner, draft.id, "source-confirm-command", command);
  assert.deepEqual(replay, first);
  assert.deepEqual(await snapshot(repository), after);
  assert.equal((await repository.listPlans(owner)).length, beforePlans + 1);
  assert.equal((await repository.listTasks(owner)).length, beforeTasks + 1);
  assert.equal(first.tasks.length, 1);
  assert.equal(first.tasks[0].title, "Reviewed next arrangement");
  assert.equal((first.draft as any).source_reflection_id, reflection.id);
  assert.equal((first.draft as any).source_reflection_version, reflection.version);
});

test("a reflection changed after review cannot be confirmed from its stale revision", async () => {
  const { repository, manual, reflections, reflection, reflectionInput, continuation, confirm } = await fixture();
  const draft = await manual.create(owner, "stale-source-create", continuation());
  await reflections.save(owner, reflection.id, { ...reflectionInput, base_version: reflection.version, content: "A newer observation" });
  const before = await snapshot(repository);
  await assert.rejects(confirm(draft.id, "stale-source-confirm"), { statusCode: 409 });
  assert.deepEqual(await snapshot(repository), before);
  assert.equal(await repository.getOperation(owner, "stale-source-confirm"), undefined);
});

for (const mismatch of ["foreign owner", "foreign goal"] as const) {
  test(`a ${mismatch} reflection cannot source this goal's next arrangement`, async () => {
    const { repository, manual, goals, reflections, continuation, confirm } = await fixture();
    const otherOwner = mismatch === "foreign owner" ? { ...owner, userId: "other-owner" } : owner;
    const foreignGoal = await goals.create(otherOwner, { title: "Unrelated goal", constraints: {} });
    const foreign = await reflections.save(otherOwner, "foreign-reflection", { goal_id: foreignGoal.id,
      period_start: "2026-10-31", period_end: "2026-10-31", content: "Private observation", next_action: "Private suggestion", base_version: 0 });
    const tasksBefore = await repository.listTasks(owner);
    await assert.rejects(async () => {
      const draft = await manual.create(owner, "foreign-source-create", continuation({ source_reflection_id: foreign.id, source_reflection_version: foreign.version }));
      await confirm(draft.id, "foreign-source-confirm");
    }, rejectedReview);
    assert.deepEqual(await repository.listTasks(owner), tasksBefore);
    assert.equal(await repository.getOperation(owner, "foreign-source-confirm"), undefined);
  });
}

for (const patch of [
  { source_reflection_id: undefined },
  { source_reflection_version: undefined },
  { goal_id: undefined },
]) {
  test(`a reflection source requires its ID/version pair and explicit goal (${Object.keys(patch)[0]})`, async () => {
    const { manual, continuation } = await fixture();
    await assert.rejects(manual.create(owner, "missing-source-create", continuation(patch)), { statusCode: 422 });
  });
}

test("two distinct reviewed drafts cannot both consume the same reflection revision", async () => {
  const { repository, manual, continuation, confirm } = await fixture();
  const first = await manual.create(owner, "first-next-create", continuation());
  const second = await manual.create(owner, "second-next-create", continuation({ tasks: [action("second-next", "A different next arrangement")] }));
  await confirm(first.id, "first-next-confirm");
  const before = await snapshot(repository);
  // confirm() reloads the goal version so this exercises source reuse, not a stale-goal conflict.
  await assert.rejects(confirm(second.id, "second-next-confirm"), { statusCode: 409 });
  assert.deepEqual(await snapshot(repository), before);
  assert.equal(await repository.getOperation(owner, "second-next-confirm"), undefined);
});

test("selected replacement cancels only the reviewed pending task and preserves completed facts", async () => {
  const { repository, manual, tasks, existing, continuation, confirm } = await fixture();
  const completed = await tasks.command(owner, existing[0].id, existing[0].version, { action: "complete", actualMinutes: 7, notes: "Historical evidence" });
  const completionEvents = (await repository.listExecutionEvents(owner)).filter(event => event.aggregateId === completed.id);
  const selected = existing[1], untouched = existing[2];
  const draft = await manual.create(owner, "replace-create", continuation({
    replace_tasks: [{ id: selected.id, version: selected.version }],
    tasks: [{ ...action("replacement", "A smaller reviewed arrangement"), source_task_id: selected.id }],
  }));
  assert.deepEqual(await repository.getTask(owner, selected.id), selected);
  const result = await confirm(draft.id, "replace-confirm");
  assert.equal((await repository.getTask(owner, selected.id))?.status, "cancelled");
  assert.deepEqual(await repository.getTask(owner, untouched.id), untouched);
  assert.deepEqual(await repository.getTask(owner, completed.id), completed);
  assert.deepEqual((await repository.listExecutionEvents(owner)).filter(event => event.aggregateId === completed.id), completionEvents);
  const created = await repository.getTask(owner, result.tasks[0].id);
  assert.equal(created?.lineageId, selected.lineageId ?? selected.id);
  assert.equal(created?.status, "pending");
});

test("a replacement task changed after review rolls back the entire confirmation", async () => {
  const { repository, manual, tasks, existing, continuation, confirm } = await fixture();
  const selected = existing[1];
  const draft = await manual.create(owner, "stale-task-create", continuation({ replace_tasks: [{ id: selected.id, version: selected.version }] }));
  await tasks.command(owner, selected.id, selected.version, { action: "start" });
  const before = await snapshot(repository);
  await assert.rejects(confirm(draft.id, "stale-task-confirm"), { statusCode: 409 });
  assert.deepEqual(await snapshot(repository), before);
  assert.equal(await repository.getOperation(owner, "stale-task-confirm"), undefined);
});

for (const target of ["completed", "foreign goal", "foreign owner"] as const) {
  test(`a ${target} task cannot be selected for replacement`, async () => {
    const { repository, manual, tasks, goals, existing, continuation, confirm } = await fixture();
    let selected = existing[0];
    if (target === "completed") {
      selected = await tasks.command(owner, selected.id, selected.version, { action: "complete", actualMinutes: 9 });
    } else {
      const otherOwner = target === "foreign owner" ? { ...owner, userId: "unrelated-owner" } : owner;
      const otherGoal = await goals.create(otherOwner, { title: "Unrelated work", constraints: {} });
      const otherDraft = await manual.create(otherOwner, "other-work-create", {
        ...draftInput([action("unrelated-work")]), goal_id: otherGoal.id,
      });
      const otherPlan = await manual.confirm(otherOwner, otherDraft.id, "other-work-confirm", {
        base_version: otherDraft.version, goal_base_version: otherDraft.goal_version,
      });
      selected = (await repository.getTask(otherOwner, otherPlan.tasks[0].id))!;
    }
    const selectedOwner = { appId: selected.appId, userId: selected.userId };
    const before = await repository.listTasks(owner);
    await assert.rejects(async () => {
      const draft = await manual.create(owner, "invalid-replacement-create", continuation({
        replace_tasks: [{ id: selected.id, version: selected.version }],
      }));
      await confirm(draft.id, "invalid-replacement-confirm");
    }, rejectedReview);
    assert.deepEqual(await repository.listTasks(owner), before);
    assert.deepEqual(await repository.getTask(selectedOwner, selected.id), selected);
    assert.equal(await repository.getOperation(owner, "invalid-replacement-confirm"), undefined);
  });
}

test("replacement materialization failure leaves selected tasks, draft, source and receipt unchanged", async () => {
  const { repository, manual, existing, continuation, confirm } = await fixture();
  const draft = await manual.create(owner, "rollback-create", continuation({ replace_tasks: [{ id: existing[1].id, version: existing[1].version }] }));
  const before = await snapshot(repository);
  const saveTask = repository.saveTask.bind(repository);
  repository.saveTask = async (...args) => {
    if (args[0].planId === draft.id) throw new Error("injected next-arrangement failure");
    return saveTask(...args);
  };
  await assert.rejects(confirm(draft.id, "rollback-confirm"), /injected next-arrangement failure/);
  assert.deepEqual(await snapshot(repository), before);
  assert.equal(await repository.getOperation(owner, "rollback-confirm"), undefined);
});

test("paused manual resumption requires explicit coverage of every outstanding task", async () => {
  const { repository, manual, goals, plan, existing, continuation, confirm } = await fixture();
  await goals.transition(owner, plan.goal_id, plan.goal_version, "pause");
  const beforeTasks = await repository.listTasks(owner);
  await assert.rejects(async () => {
    const draft = await manual.create(owner, "partial-resume-create", continuation({ resume_goal: true,
      replace_tasks: [{ id: existing[0].id, version: existing[0].version }] }));
    await confirm(draft.id, "partial-resume-confirm");
  }, rejectedReview);
  assert.deepEqual(await repository.listTasks(owner), beforeTasks);
  assert.equal((await goals.get(owner, plan.goal_id)).status, "paused");
});

test("complete reviewed resumption replaces outstanding work with explicit actions and activates the goal", async () => {
  const { repository, manual, goals, tasks, plan, existing, continuation, confirm } = await fixture();
  const completed = await tasks.command(owner, existing[0].id, existing[0].version, { action: "complete", actualMinutes: 8 });
  const inProgress = await tasks.command(owner, existing[1].id, existing[1].version, { action: "start" });
  await goals.transition(owner, plan.goal_id, plan.goal_version, "pause");
  const outstanding = [inProgress, existing[2]];
  const draft = await manual.create(owner, "resume-create", continuation({ resume_goal: true,
    replace_tasks: outstanding.map(task => ({ id: task.id, version: task.version })),
    tasks: [{ ...action("resume-action", "One explicitly reviewed restart"), source_task_id: inProgress.id }],
  }));
  assert.equal((await goals.get(owner, plan.goal_id)).status, "paused");
  assert.equal((await repository.listTasks(owner)).length, existing.length);
  const result = await confirm(draft.id, "resume-confirm");
  assert.equal((await goals.get(owner, plan.goal_id)).status, "active");
  assert.equal(result.tasks.length, 1);
  assert.equal(result.tasks[0].title, "One explicitly reviewed restart");
  assert.equal((await repository.listTasks(owner)).length, existing.length + 1);
  for (const old of outstanding) assert.equal((await repository.getTask(owner, old.id))?.status, "cancelled");
  assert.deepEqual(await repository.getTask(owner, completed.id), completed);
});
