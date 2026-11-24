import assert from "node:assert/strict";
import test from "node:test";
import { LightTickGoalService } from "../../src/modules/lighttick/lighttick-goal.service.ts";
import { LightTickTaskService } from "../../src/modules/lighttick/lighttick-task.service.ts";
import { LightTickTodayService } from "../../src/modules/lighttick/lighttick-today.service.ts";
import { ManualPlanningService } from "../../src/modules/lighttick/manual/manual-planning.service.ts";
import { readPlanningAgenda } from "../../src/modules/lighttick/planning/planning-agenda.ts";
import { setTaskPrerequisite } from "../../src/modules/lighttick/planning/task-prerequisite.ts";
import { InMemoryLightTickRepository } from "../../src/testing/in-memory-lighttick-repository.ts";

test("Today keeps a late dependent visible without changing its date, and agenda resolves a source outside the window", async () => {
  let now = new Date("2026-11-23T06:00:00Z");
  const clock = () => now;
  const owner = { appId: "lighttick", userId: "prerequisite-projection-owner" } as const;
  const repository = new InMemoryLightTickRepository();
  const goals = new LightTickGoalService(repository, clock);
  const manual = new ManualPlanningService(repository, clock);
  const tasks = new LightTickTaskService(repository, clock);
  const today = new LightTickTodayService(repository, clock);
  const goal = await goals.create(owner, { title: "练习开场汇报", constraints: {} });
  const step = (id: string, title: string, scheduled_for: string) => ({ id, title, scheduled_for,
    completion_criteria: "留下一句可以回看的说明", guidance: "", estimated_minutes: 10 });
  const draft = await manual.create(owner, "draft-with-prerequisites", { goal_id: goal.id,
    title: "这周的开场练习", completion_criteria: "保留一段开场", period_start: "2026-11-23", period_end: "2026-11-29",
    tasks: [step("task-source", "整理三个关键点", "2026-11-23"), step("task-dependent", "录一次开场", "2026-11-24"),
      step("task-other", "回看常见问题", "2026-11-24")] });
  await manual.confirm(owner, draft.id, "confirm-with-prerequisites", { base_version: draft.version, goal_base_version: draft.goal_version });
  const planned = await repository.listTasks(owner, draft.id);
  const source = planned.find(task => task.title === "整理三个关键点")!;
  const dependent = planned.find(task => task.title === "录一次开场")!;
  const other = planned.find(task => task.title === "回看常见问题")!;
  const receipt = await repository.transaction(owner, async () => {
    await repository.lockPlanningOwner(owner);
    return setTaskPrerequisite(repository, owner, dependent.id, { base_version: dependent.version, prerequisite_task_id: source.id }, clock());
  });

  assert.equal((await today.get(owner)).prerequisiteWaitingTasks, undefined, "Waiting does not pull a future task into Today.");
  now = new Date("2026-11-24T06:00:00Z");
  const waiting = await today.get(owner);
  assert.deepEqual(waiting.executableTasks.map(task => task.id), [other.id]);
  assert.deepEqual(waiting.prerequisiteWaitingTasks?.map(task => task.id), [dependent.id]);
  const before = await readPlanningAgenda(repository, owner, clock(), { starts_on: "2026-11-24", ends_on: "2026-11-24" });
  assert.deepEqual(before.items.find(task => task.id === dependent.id)?.task_prerequisite, {
    task_id: source.id, title: source.title, state: "waiting",
  });
  now = new Date("2026-11-25T06:00:00Z");
  assert.equal((await today.get(owner)).missedTasks?.some(task => task.id === dependent.id), false);
  await tasks.command(owner, source.id, source.version, { action: "complete", actualMinutes: 8 });
  const released = await today.get(owner);
  assert.deepEqual(released.prerequisiteReadyTasks?.map(({ task, rescheduleThrough }) => [task.id, task.version, task.scheduledFor, rescheduleThrough]),
    [[dependent.id, receipt.task_version, "2026-11-24", "2026-11-29"]]);
  assert.equal(released.executableTasks.some(task => task.id === dependent.id), false);
  now = new Date("2026-11-30T06:00:00Z");
  const expired = (await today.get(owner)).prerequisiteReadyTasks?.[0];
  assert.equal(expired?.task.id, dependent.id);
  assert.equal(expired.rescheduleThrough, undefined);
});
