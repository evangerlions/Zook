import assert from "node:assert/strict";
import test from "node:test";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { LightTickTodayDataSchema } from "../../src/generated/openapi/public-contracts.generated.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { LightTickPlanService, type ProposedTaskInput } from "../../src/modules/lighttick/lighttick-plan.service.ts";
import { LightTickTaskService } from "../../src/modules/lighttick/lighttick-task.service.ts";
import { LightTickTodayService } from "../../src/modules/lighttick/lighttick-today.service.ts";
import type { LightTickTaskRow } from "../../src/modules/lighttick/lighttick.types.ts";
import { ManualPlanningService } from "../../src/modules/lighttick/manual/manual-planning.service.ts";
import { GoalRoadmapService } from "../../src/modules/lighttick/planning/goal-roadmap.ts";
import type { HttpRequest } from "../../src/shared/types.ts";
import { createApplication } from "../support/create-test-application.ts";

const appId = "lighttick";
const owner = { appId, userId: "user_alice" } as const;
const previous = "2026-11-29", current = "2026-11-30", following = "2026-12-01";
const priorInstant = new Date("2026-11-29T15:59:00Z");
const nextInstant = new Date("2026-11-29T16:01:00Z");

async function fixture() {
  const seed = buildDefaultSeed(undefined, { includeLightTick: true });
  for (const userId of [owner.userId, "user_bob"]) seed.appUsers.push({
    id: "missed-" + userId, appId, userId, status: "ACTIVE", accountRegion: "UNKNOWN", joinedAt: priorInstant.toISOString(),
  });
  const { app, services: { lighttickRuntime: runtime, tokenService } } = await createApplication({ seed, lighttickEnabled: true });
  const repository = runtime.repository;
  let instant = priorInstant;
  const clock = () => instant;
  runtime.today = new LightTickTodayService(repository, clock);
  runtime.tasks = new LightTickTaskService(repository, clock);
  const plans = new LightTickPlanService(repository, clock);
  const roadmaps = new GoalRoadmapService(repository, clock);
  const writes = new ManualPlanningService(repository, clock);
  let sequence = 0;
  async function call(path: string, method: HttpRequest["method"] = "GET", body?: HttpRequest["body"], options: {
    key?: string; user?: string; oldSchema?: boolean;
  } = {}) {
    const result = await app.handle({ path: "/api/v1/lighttick/" + path, method, body, headers: {
      "x-app-id": appId, authorization: "Bearer " + tokenService.issueAccessToken(options.user ?? owner.userId, appId),
      ...(options.oldSchema ? {} : { "x-lighttick-task-schema": "2" }),
      "idempotency-key": options.key ?? "missed-test-" + (++sequence),
    } });
    return { ...result, envelope: result.body as { code: string; data: any } };
  }
  async function write(path: string, method: HttpRequest["method"], body: HttpRequest["body"]) {
    const result = await call(path, method, body);
    assert.equal(result.statusCode, 200, JSON.stringify(result.body));
    return result.envelope.data;
  }
  const goal = (title: string, targetDate?: string) => runtime.goals.create(owner, { title, targetDate, constraints: {} });
  async function confirm(goalId: string, tasks: ProposedTaskInput[], options: { end?: string; stageId?: string } = {}) {
    const proposed = await plans.createProposed(owner, { goalId, source: "template", granularity: "week",
      periodStart: "2026-11-28", periodEnd: options.end ?? "2026-12-06", tasks,
      ...(options.stageId ? { metadata: { draft: { stage_id: options.stageId } } } : {}) });
    return plans.confirm(owner, proposed.id, proposed.version);
  }
  function seedTask(task: LightTickTaskRow, delta: Partial<LightTickTaskRow>) {
    return repository.saveTask({ ...task, ...delta }, writes.write(owner, "task", task.id, task.version + 1,
      "task_missed_test_seed", clock().toISOString(), {}), task.version);
  }
  const reschedule = (id: string, version: number, date: string, key?: string) => call("tasks/" + id + "/reschedule", "POST",
    { base_version: version, target_date: date }, { key });
  await write("profile", "PATCH", { base_version: 0, timezone: "Asia/Shanghai" });
  return { call, write, repository, runtime, goal, confirm, roadmaps, seedTask, reschedule, clock,
    advance: () => { instant = nextInstant; } };
}

test("Today surfaces yesterday's eligible ordinary task identities and permits a confirmed same-task move", async () => {
  const { call, write, repository, runtime, goal, confirm, seedTask, reschedule, clock, advance } = await fixture();
  const group = await goal("Continue a project");
  const { tasks } = await confirm(group.id, [
    { title: "Started late", scheduledFor: "2026-11-28T16:15:00Z", estimatedMinutes: 10, steps: ["A checked step"] },
    { title: "Pending yesterday", scheduledFor: previous, estimatedMinutes: 15 },
    { title: "Estimate without partial work", scheduledFor: previous, estimatedMinutes: 20 },
    { title: "Keep partial", scheduledFor: previous, estimatedMinutes: 10 },
    { title: "Waiting for reply", scheduledFor: previous, estimatedMinutes: 10 },
    { title: "Explicitly skipped", scheduledFor: previous, estimatedMinutes: 10 },
    { title: "Course task", scheduledFor: previous, estimatedMinutes: 10 },
    { title: "Today's work", scheduledFor: current, estimatedMinutes: 25 },
  ]);
  const [start, pending, estimateOnly, partial, waiting, skipped, lesson, today] = tasks;
  assert.ok(start && pending && estimateOnly && partial && waiting && skipped && lesson && today);
  const withNote = await seedTask(start, { notes: "Keep this note." });
  const started = await write("tasks/" + start.id + "/start", "POST", { base_version: withNote.version });
  assert.equal((await reschedule(start.id, started.version, current)).statusCode, 409);
  await write("tasks/" + estimateOnly.id + "/progress", "POST", { base_version: estimateOnly.version,
    action: "set_remaining", remaining_estimated_minutes: null });
  await write("tasks/" + partial.id + "/progress", "POST", { base_version: partial.version,
    action: "record_partial", outcome: "One paragraph complete.", remaining_estimated_minutes: 4 });
  await write("tasks/" + waiting.id + "/progress", "POST", { base_version: waiting.version, action: "wait", reason: "Waiting for a reply" });
  await write("tasks/" + skipped.id + "/skip", "POST", { base_version: skipped.version, reason_code: "no_time" });
  await seedTask(lesson, { lessonSource: { route_id: "course-route", route_version: 1, lesson_number: 1,
    lesson_id: "lesson", content_version: "a".repeat(64), purpose: "learn" } });
  await repository.saveLearningAuthority({ ...owner, module: "learning", phase: "zook", readingEnabled: true, privateEnabled: false,
    epoch: 1, revision: 1, manifestHash: null, sourceBinding: null, updatedAt: clock().toISOString() }, 0);
  const stopped = await goal("Paused project");
  await confirm(stopped.id, [{ title: "Paused action", scheduledFor: previous, estimatedMinutes: 10 }]);
  const paused = await repository.getGoal(owner, stopped.id);
  await runtime.goals.transition(owner, stopped.id, paused!.version, "pause");
  const old = await goal("Expired plan");
  await confirm(old.id, [{ title: "Expired action", scheduledFor: previous, estimatedMinutes: 10 }], { end: previous });
  assert.equal((await call("today")).envelope.data.missed_tasks, undefined);

  advance();
  const before = await repository.listTasks(owner);
  const result = await call("today");
  assert.equal(result.statusCode, 200, JSON.stringify(result.body));
  const { data } = result.envelope;
  const ajv = new Ajv2020({ strict: false });
  addFormats(ajv);
  const validate = ajv.compile(LightTickTodayDataSchema);
  assert.equal(validate(JSON.parse(JSON.stringify(data))), true, JSON.stringify(validate.errors));
  assert.equal(data.business_date, current);
  const ids = (rows: { id: string }[]) => rows.map(row => row.id).sort();
  assert.deepEqual(ids(data.missed_tasks), [start.id, pending.id, estimateOnly.id].sort());
  const row = data.missed_tasks.find((item: { id: string }) => item.id === started.id);
  assert.equal(row.scheduled_date, previous);
  assert.equal(row.steps[0].title, "A checked step");
  assert.deepEqual(ids(data.continuation_tasks), [partial.id, estimateOnly.id].sort());
  assert.deepEqual(ids(data.waiting_tasks), [waiting.id]);
  assert.deepEqual(ids(data.tasks), [today.id]);
  assert.equal(data.primary_task.id, today.id);
  assert.equal(data.remaining_estimated_minutes, 25);
  assert.equal((await call("today", "GET", undefined, { user: "user_bob" })).envelope.data.missed_tasks, undefined);
  assert.equal((await call("today", "GET", undefined, { oldSchema: true })).envelope.data.missed_tasks, undefined);
  assert.deepEqual(await repository.listTasks(owner), before);

  const estimated = data.missed_tasks.find((item: { id: string }) => item.id === estimateOnly.id);
  await write("tasks/" + estimateOnly.id + "/progress", "POST", { base_version: estimated.version,
    action: "set_remaining", remaining_estimated_minutes: 16 });
  assert.equal((await call("today")).envelope.data.missed_tasks.find((item: { id: string }) => item.id === estimateOnly.id)
    .execution_progress.remaining_estimated_minutes, 16);

  const moved = await reschedule(start.id, started.version, current, "move-started-original");
  assert.equal(moved.statusCode, 200, JSON.stringify(moved.body));
  assert.equal(moved.envelope.data.status, "in_progress");
  assert.equal(moved.envelope.data.version, started.version + 1);
  assert.equal(moved.envelope.data.note, "Keep this note.");
  assert.deepEqual(moved.envelope.data.steps, row.steps);
  assert.equal((await repository.getTask(owner, start.id))?.startedAt, priorInstant.toISOString());
  assert.deepEqual((await reschedule(start.id, started.version, current, "move-started-original")).envelope.data, moved.envelope.data);
  assert.equal((await reschedule(start.id, started.version, following)).statusCode, 409);
  const after = (await call("today")).envelope.data;
  assert.deepEqual(ids(after.missed_tasks), [pending.id, estimateOnly.id].sort());
  assert.deepEqual(ids(after.tasks), [start.id, today.id].sort());
  assert.equal(after.remaining_estimated_minutes, 35);
});

test("ordinary reschedule respects goal deadline, roadmap window and the new week's shared budget", async () => {
  const { call, write, repository, runtime, goal, confirm, reschedule, roadmaps, advance } = await fixture();
  const fixed = await goal("Fixed deadline", current);
  const { tasks: [goalTask] } = await confirm(fixed.id, [{ title: "Within the original deadline", scheduledFor: previous, estimatedMinutes: 10 }]);
  const staged = await goal("With a stage");
  const stage = { id: "one", title: "A stage", outcome_criteria: "Check the result", starts_on: previous, ends_on: current };
  await roadmaps.update(owner, staged.id, { base_version: 0, stages: [stage] });
  const { tasks: [stageTask] } = await confirm(staged.id, [{ title: "Inside the stage", scheduledFor: previous, estimatedMinutes: 10 }], { stageId: "one" });
  const other = await goal("Budget check");
  const { tasks: [budgetTask] } = await confirm(other.id, [{ title: "Already estimated", scheduledFor: previous, estimatedMinutes: 15 },
    { title: "Load in the new week", scheduledFor: current, estimatedMinutes: 20 }]);
  const report = await runtime.goals.create(owner, { title: "Reporting practice", constraints: { growth_practice: "work_report" } });
  const { tasks: [olderReport, dueReport, associatedTask] } = await confirm(report.id, [
    { title: "60 秒工作汇报练习", scheduledFor: previous, estimatedMinutes: 5 },
    { title: "60 秒工作汇报练习", scheduledFor: current, estimatedMinutes: 5 },
    { title: "Review other report material", scheduledFor: previous, estimatedMinutes: 10 },
  ]);
  assert.ok(goalTask && stageTask && budgetTask && olderReport && dueReport && associatedTask);
  await write("planning-capacity", "PATCH", { base_version: 0, weekly_available_minutes: 30, plan_percent: 100 });
  advance();

  const deadline = await reschedule(goalTask.id, goalTask.version, following);
  assert.equal(deadline.statusCode, 409);
  assert.equal(deadline.envelope.code, "LIGHTTICK_PLAN_CONSTRAINT_FAILED");
  const outsideStage = await reschedule(stageTask.id, stageTask.version, following);
  assert.equal(outsideStage.statusCode, 422);
  assert.equal(outsideStage.envelope.code, "LIGHTTICK_ROADMAP_STAGE_WINDOW");
  const capacity = await reschedule(budgetTask.id, budgetTask.version, current);
  assert.equal(capacity.statusCode, 422);
  assert.equal(capacity.envelope.code, "LIGHTTICK_WEEKLY_CAPACITY_EXCEEDED");
  for (const task of [goalTask, stageTask, budgetTask]) assert.deepEqual(await repository.getTask(owner, task.id), task);
  const today = (await call("today")).envelope.data;
  assert.deepEqual(today.missed_tasks.map((task: { id: string }) => task.id).sort(),
    [goalTask.id, stageTask.id, budgetTask.id, associatedTask.id].sort());
  assert.ok(today.tasks.some((task: { id: string }) => task.id === dueReport.id));
});
