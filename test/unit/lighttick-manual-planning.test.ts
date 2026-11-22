import test from "node:test";
import assert from "node:assert/strict";
import { InMemoryLightTickRepository } from "../../src/testing/in-memory-lighttick-repository.ts";
import { ManualPlanningService } from "../../src/modules/lighttick/manual/manual-planning.service.ts";
import { LightTickGoalService } from "../../src/modules/lighttick/lighttick-goal.service.ts";
import { LightTickTodayService } from "../../src/modules/lighttick/lighttick-today.service.ts";
const owner = { appId: "lighttick", userId: "manual-owner" } as const;
const clock = () => new Date("2026-10-31T04:00:00.000Z");
const input = () => ({
  title: "Practice clearly",
  completion_criteria: "Explain an example",
  period_start: "2026-10-31",
  period_end: "2026-11-06",
  tasks: [
    {
      id: "action-one",
      title: "Explain a situation",
      scheduled_for: "2026-10-31",
      estimated_minutes: 15,
      completion_criteria: "Two examples",
      guidance: "",
    },
    {
      id: "action-two",
      title: "Choose next topic",
      scheduled_for: null,
      estimated_minutes: null,
      completion_criteria: "",
      guidance: "",
    },
  ],
});
test("manual drafts are inert; atomic confirm is replayable, unknowns stay unknown and undated tasks stay out of Today", async () => {
  const repo = new InMemoryLightTickRepository(),
    service = new ManualPlanningService(repo, clock);
  const draft = await service.create(owner, "manual-create-0001", input());
  assert.equal((await repo.listTasks(owner)).length, 0);
  const edited = await service.update(owner, draft.id, "manual-edit-0001", {
    ...input(),
    base_version: 1,
  });
  await assert.rejects(
    () =>
      service.confirm(owner, draft.id, "manual-confirm-stale", {
        base_version: 1,
        goal_base_version: draft.goal_version,
      }),
    { statusCode: 409 },
  );
  const command = {
    base_version: edited.version,
    goal_base_version: edited.goal_version,
  };
  const [a, b] = await Promise.all([
    service.confirm(owner, draft.id, "manual-confirm-0001", command),
    service.confirm(owner, draft.id, "manual-confirm-0001", command),
  ]);
  assert.deepEqual(a, b);
  assert.equal((await repo.listTasks(owner)).length, 2);
  assert.equal(
    a.tasks.find((t) => t.scheduled_date == null)?.estimated_duration_minutes,
    null,
  );
  const today = await new LightTickTodayService(repo, clock).get(owner);
  assert.equal(today.executableTasks.length, 1);
  assert.equal(today.remainingEstimatedMinutes, 15);
  await assert.rejects(() =>
    service.confirm(owner, draft.id, "manual-confirm-0001", {
      ...command,
      base_version: 99,
    }),
  );
  await assert.rejects(
    () => service.get({ ...owner, userId: "other" }, draft.id),
    { statusCode: 404 },
  );
});
test("manual input rejects invalid dates, duplicate IDs/title/date, window and capacity without persisting", async () => {
  const repo = new InMemoryLightTickRepository(),
    service = new ManualPlanningService(repo, clock);
  for (const bad of [
    { ...input(), period_end: "2026-02-30" },
    { ...input(), period_end: "2026-10-01" },
    {
      ...input(),
      tasks: [{ ...input().tasks[0], scheduled_for: "2026-11-30" }],
    },
    { ...input(), tasks: [input().tasks[0], input().tasks[0]] },
    { ...input(), tasks: [{ ...input().tasks[0], estimated_minutes: 0 }] },
    {
      ...input(),
      tasks: [
        { ...input().tasks[0], estimated_minutes: 1000 },
        {
          ...input().tasks[0],
          id: "different",
          title: "Too much",
          estimated_minutes: 500,
        },
      ],
    },
  ]) {
    await assert.rejects(() =>
      service.create(owner, "manual-invalid-0001", bad as any),
    );
  }
  assert.equal((await repo.listPlans(owner)).length, 0);
  assert.equal((await repo.listGoals(owner)).length, 0);
});
test("failed materialization rolls back activation, tasks and receipt; a new instance can retry the original command", async () => {
  const repo = new InMemoryLightTickRepository(),
    service = new ManualPlanningService(repo, clock),
    draft = await service.create(owner, "manual-create-0001", input());
  const save = repo.saveTask.bind(repo);
  let writes = 0;
  repo.saveTask = async (...args) => {
    if (++writes === 2) throw Error("injected write failure");
    return save(...args);
  };
  const command = { base_version: 1, goal_base_version: 1 };
  await assert.rejects(() =>
    service.confirm(owner, draft.id, "manual-confirm-0001", command),
  );
  assert.equal((await repo.getPlan(owner, draft.id))?.status, "proposed");
  assert.equal((await repo.listTasks(owner)).length, 0);
  assert.equal(
    await repo.getOperation(owner, "manual-confirm-0001"),
    undefined,
  );
  repo.saveTask = save;
  assert.equal(
    (
      await new ManualPlanningService(repo, clock).confirm(
        owner,
        draft.id,
        "manual-confirm-0001",
        command,
      )
    ).tasks.length,
    2,
  );
});

test("a late receipt collision from another domain rolls back the entire manual write", async () => {
  const repo = new InMemoryLightTickRepository(),
    service = new ManualPlanningService(repo, clock);
  repo.saveOperation = async (row) => ({
    ...row,
    payloadHash: "another-payload",
    action: "another-domain",
    resultPayload: { unrelated: true },
  });
  await assert.rejects(
    () => service.create(owner, "manual-late-collision", input()),
    { statusCode: 409 },
  );
  assert.equal((await repo.listGoals(owner)).length, 0);
  assert.equal((await repo.listPlans(owner)).length, 0);
});

test("confirming a plan never renames the goal: plan title stays on the plan", async () => {
  const repo = new InMemoryLightTickRepository(),
    service = new ManualPlanningService(repo, clock),
    goals = new LightTickGoalService(repo, clock);
  const goal = await goals.create(owner, {
    title: "我自己的目标标题",
    constraints: {},
  });
  const draft = await service.create(owner, "manual-create-keep-title", {
    ...input(),
    goal_id: goal.id,
    title: "本周计划标题",
  });
  const confirmed = await service.confirm(
    owner,
    draft.id,
    "manual-confirm-keep-title",
    { base_version: draft.version, goal_base_version: draft.goal_version },
  );
  // 目标标题属于目标本身，确认计划不得改写它
  assert.equal((await repo.getGoal(owner, goal.id))?.title, "我自己的目标标题");
  // 计划标题仍保存在计划自己的 draft 上，没有丢失
  assert.equal(confirmed.draft.title, "本周计划标题");
});

test("plan confirmation seeds the first nonblank goal criterion and keeps future plan criteria separate", async () => {
  const repo = new InMemoryLightTickRepository();
  const service = new ManualPlanningService(repo, clock);
  const goals = new LightTickGoalService(repo, clock);
  async function confirm(key: string, completion_criteria: string, goal_id?: string) {
    const draft = await service.create(owner, "draft-" + key, { ...input(), goal_id, completion_criteria,
      tasks: [{ ...input().tasks[0], title: key }] });
    return service.confirm(owner, draft.id, "confirm-" + key, { base_version: draft.version, goal_base_version: draft.goal_version });
  }
  const explicit = await goals.create(owner, { title: "Owner defined outcome", constraints: { completion_criteria: "Publish the final report" } });
  await confirm("explicit-goal-plan", "Gather evidence", explicit.id);
  assert.equal((await goals.get(owner, explicit.id)).constraints.completion_criteria, "Publish the final report");
  const historical = await confirm("first-draft", "  ");
  assert.equal((await goals.get(owner, historical.goal_id)).constraints.completion_criteria, undefined);
  const first = await confirm("first-real-criterion", " Explain an example ", historical.goal_id);
  assert.equal((await goals.get(owner, first.goal_id)).constraints.completion_criteria, "Explain an example");
  const later = await confirm("later-plan", "Write the outline", first.goal_id);
  assert.equal(later.draft.completion_criteria, "Write the outline");
  const current = await goals.get(owner, first.goal_id);
  assert.equal(current.constraints.completion_criteria, "Explain an example");

  await goals.update(owner, current.id, current.version, { constraints: {} });
  await confirm("after-owner-clear", "Do not restore the criterion", current.id);
  assert.equal((await goals.get(owner, current.id)).constraints.completion_criteria, undefined);
});
