import assert from "node:assert/strict";
import test from "node:test";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { LightTickConditionReviewPreviewEnvelopeSchema, LightTickConditionReviewApplyEnvelopeSchema } from "../../src/generated/openapi/public-contracts.generated.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { LightTickTaskService } from "../../src/modules/lighttick/lighttick-task.service.ts";
import { LightTickTodayService } from "../../src/modules/lighttick/lighttick-today.service.ts";
import type { ManualDraft } from "../../src/modules/lighttick/manual/manual-planning.types.ts";
import type { HttpRequest } from "../../src/shared/types.ts";
import { createApplication } from "../support/create-test-application.ts";

const appId = "lighttick";
const owner = { appId, userId: "user_alice" };
const now = new Date("2026-11-29T16:30:00Z");
const monday = "2026-11-30", tuesday = "2026-12-01", end = "2026-12-06";

async function fixture() {
  const seed = buildDefaultSeed(undefined, { includeLightTick: true });
  for (const userId of [owner.userId, "user_bob"])
    seed.appUsers.push({ id: "condition-review-" + userId, appId, userId, status: "ACTIVE", accountRegion: "UNKNOWN", joinedAt: now.toISOString() });
  const { app, services: { lighttickRuntime: runtime, tokenService } } = await createApplication({ seed, lighttickEnabled: true });
  const repository = runtime.repository;
  runtime.today = new LightTickTodayService(repository, () => now);
  runtime.tasks = new LightTickTaskService(repository, () => now);
  let sequence = 0;
  async function call(path: string, method: HttpRequest["method"] = "GET", body?: HttpRequest["body"],
    { key, userId = owner.userId, query = {} }: { key?: string; userId?: string; query?: HttpRequest["query"] } = {}) {
    const response = await app.handle({ path: "/api/v1/lighttick/" + path, method, query, body, headers: {
      authorization: "Bearer " + tokenService.issueAccessToken(userId, appId),
      "x-app-id": appId, "x-lighttick-task-schema": "2", "idempotency-key": key ?? "condition-review-" + (++sequence),
    } });
    return { ...response, ...response.body as { data: any; code: string; details?: unknown } };
  }
  assert.equal((await call("profile", "PATCH", { base_version: 0, timezone: "Asia/Shanghai" })).statusCode, 200);
  async function arrange(titles: [string, string, number | null][], extra: Partial<ManualDraft> = {}) {
    const proposed = await call("manual-plans", "POST", {
      title: "Condition work", completion_criteria: "Finish the report", period_start: monday, period_end: end,
      tasks: titles.map(([title, scheduled_for, estimated_minutes], i) =>
        ({ id: "joint-ordinary-" + i, title, scheduled_for, estimated_minutes, completion_criteria: "One result", guidance: "" })), ...extra,
    });
    assert.equal(proposed.statusCode, 200, JSON.stringify(proposed.body));
    const confirmed = await call("manual-plans/" + proposed.data.id + "/confirm", "POST",
      { base_version: proposed.data.version, goal_base_version: proposed.data.goal_version });
    assert.equal(confirmed.statusCode, 200, JSON.stringify(confirmed.body));
    return confirmed.data;
  }
  const complete = (task: { id: string; version: number }, actual_duration_minutes: number) =>
    call("tasks/" + task.id + "/complete", "POST", { base_version: task.version, actual_duration_minutes, note: "Actual notes" });
  const conditionFor = (version: number, daily_minutes: number) => ({
    id: "working-condition", base_version: version, condition_version: 0, scope: "ongoing", starts_on: monday,
    ends_on: null, daily_minutes, active: true, reason: "Changed personal timetable",
  });
  const move = (task: { id: string; version: number }, date: string) => ({ task_id: task.id, base_version: task.version, target_date: date });
  return { call, arrange, complete, conditionFor, move, repository };
}

test("joint condition review swaps two full days atomically and replays the same receipt after a rollback", async () => {
  const { call, arrange, complete, conditionFor, move, repository } = await fixture();
  const plan = await arrange([["A", monday, 15], ["B", tuesday, 15], ["Monday fact", monday, 10], ["Tuesday fact", tuesday, 10]]);
  const [first, b, mondayFact, tuesdayFact] = plan.tasks;
  const link = await call("tasks/" + first.id + "/prerequisite", "PUT", { base_version: first.version, prerequisite_task_id: b.id });
  assert.equal(link.statusCode, 200, JSON.stringify(link.body));
  const a = { ...first, version: link.data.task_version };
  assert.equal((await complete(mondayFact, 15)).statusCode, 200);
  assert.equal((await complete(tuesdayFact, 15)).statusCode, 200);
  const path = "goals/" + plan.goal_id + "/conditions";
  const goal = await repository.getGoal(owner, plan.goal_id);
  const completed = await repository.getTask(owner, mondayFact.id);
  const command = { period_start: monday, period_end: end, condition: conditionFor(goal!.version, 30),
    moves: [move(a, tuesday), move(b, monday)] };
  const preview = await call(path + "/preview", "POST", command);
  assert.equal(preview.statusCode, 200, JSON.stringify(preview.body));
  assert.equal(preview.headers?.["Cache-Control"], "no-store");
  assert.equal(preview.data.can_apply, true);
  assert.deepEqual(preview.data.days.slice(0, 2), [monday, tuesday].map(date => ({ date,
    before_minutes: null, after_minutes: 30, before_load: 30, after_load: 30, before_unknown: 0, after_unknown: 0, blocking: false })));
  const facts = preview.data.tasks.filter((entry: { editable: boolean }) => !entry.editable);
  assert.equal(facts.length, 2);
  assert.equal(facts[0].estimated_minutes, 15);
  assert.equal((await call(path + "/preview", "POST", command, { userId: "user_bob" })).statusCode, 404);
  assert.equal((await call(path + "/preview", "POST", { ...command, moves: [move({ ...mondayFact, version: completed!.version }, tuesday)] })).statusCode, 409);
  assert.equal((await repository.getGoal(owner, plan.goal_id))?.version, goal!.version);

  const ajv = new Ajv2020({ strict: false });
  addFormats(ajv);
  const validatePreview = ajv.compile(LightTickConditionReviewPreviewEnvelopeSchema);
  assert.equal(validatePreview(preview.body), true, JSON.stringify(validatePreview.errors));
  const input = { ...command, preview_revision: preview.data.preview_revision };
  const key = "confirmed-joint-condition";
  const saveTask = repository.saveTask.bind(repository);
  let writes = 0;
  repository.saveTask = async (...args) => {
    if (++writes === 2) throw new Error("Injected storage failure after first move");
    return saveTask(...args);
  };
  const rejected = await call(path + "/apply", "POST", input, { key });
  repository.saveTask = saveTask;
  assert.equal(rejected.statusCode, 500);
  assert.equal(await repository.getOperation(owner, key), undefined);
  assert.equal((await repository.getGoal(owner, plan.goal_id))?.version, goal!.version);
  assert.equal((await repository.getTask(owner, a.id))?.scheduledFor, monday);
  assert.equal((await repository.getTask(owner, b.id))?.scheduledFor, tuesday);

  const receipts = await Promise.all([call(path + "/apply", "POST", input, { key }), call(path + "/apply", "POST", input, { key })]);
  assert.equal(receipts[0].statusCode, 200, JSON.stringify(receipts[0].body));
  assert.deepEqual(receipts[0].data, receipts[1].data);
  const validateApply = ajv.compile(LightTickConditionReviewApplyEnvelopeSchema);
  assert.equal(validateApply(receipts[0].body), true, JSON.stringify(validateApply.errors));
  assert.equal(receipts[0].data.goal.version, goal!.version + 1);
  assert.equal(receipts[0].data.condition.revision, 1);
  const movedDependent = await repository.getTask(owner, a.id);
  assert.equal(movedDependent?.scheduledFor, tuesday);
  assert.equal(movedDependent?.prerequisiteTaskId, b.id);
  assert.equal((await call("tasks/" + a.id + "/start", "POST", { base_version: movedDependent?.version })).code,
    "LIGHTTICK_TASK_PREREQUISITE_BLOCKED");
  assert.equal((await repository.getTask(owner, b.id))?.scheduledFor, monday);
  assert.deepEqual(await repository.getTask(owner, mondayFact.id), completed);
  const stale = await call(path + "/apply", "POST", input);
  assert.equal(stale.statusCode, 409);
  assert.equal(stale.code, "LIGHTTICK_VERSION_CONFLICT");
});

test("joint preflight identifies rest, rejects an intervening change, and reconciles an already saved condition without rewriting facts", async () => {
  const { call, arrange, complete, conditionFor, move, repository } = await fixture();
  const plan = await arrange([["Open appointment", monday, 15], ["Already completed", monday, 20]]);
  const [open, finished] = plan.tasks;
  const [otherTask] = (await arrange([["Unrelated goal", tuesday, 15]])).tasks;
  assert.equal((await complete(finished, 25)).statusCode, 200);
  const originalFact = await repository.getTask(owner, finished.id);
  const path = "goals/" + plan.goal_id + "/conditions";
  const goal = await repository.getGoal(owner, plan.goal_id);
  const condition = conditionFor(goal!.version, 19);
  const window = { period_start: monday, period_end: end };
  const openMove = move(open, tuesday);
  const bad = await call(path + "/preview", "POST", { ...window, condition, moves: [] });
  assert.equal(bad.data.block_reason, "daily_over_limit");
  assert.equal((await call(path + "/preview", "POST", { ...window, condition, moves: [move(otherTask, monday)] })).statusCode, 409);
  const request = { ...window, condition, moves: [openMove] };
  const first = await call(path + "/preview", "POST", request);
  assert.equal(first.statusCode, 200, JSON.stringify(first.body));
  assert.equal(first.data.can_apply, true);
  assert.deepEqual(first.data.days[0], { date: monday, before_minutes: null, after_minutes: 19, before_load: 40,
    after_load: 25, before_unknown: 0, after_unknown: 0, blocking: false });
  const rest = await call("planning-calendar/rest", "PUT", { date: tuesday, planned_rest: true, base_version: 0 });
  assert.equal(rest.statusCode, 200, JSON.stringify(rest.body));
  const stale = await call(path + "/apply", "POST", { ...request, preview_revision: first.data.preview_revision });
  assert.equal(stale.code, "LIGHTTICK_VERSION_CONFLICT");
  const onRest = await call(path + "/preview", "POST", request);
  assert.equal(onRest.data.block_reason, "planned_rest");
  assert.equal((await call(path + "/apply", "POST", { ...request, preview_revision: onRest.data.preview_revision })).statusCode, 422);
  assert.equal((await repository.getGoal(owner, plan.goal_id))?.version, goal!.version);
  assert.equal((await repository.getTask(owner, open.id))?.scheduledFor, monday);
  assert.deepEqual(await repository.getTask(owner, finished.id), originalFact);

  assert.equal((await call("planning-calendar/rest", "PUT", { date: tuesday, planned_rest: false, base_version: 1 })).statusCode, 200);
  const saved = await call(path, "POST", condition);
  assert.equal(saved.statusCode, 200, JSON.stringify(saved.body));
  const reconcile = { ...window, condition: null, moves: [openMove] };
  const recheck = await call(path + "/preview", "POST", reconcile);
  assert.equal(recheck.data.can_apply, true);
  const result = await call(path + "/apply", "POST", { ...reconcile, preview_revision: recheck.data.preview_revision });
  assert.equal(result.statusCode, 200, JSON.stringify(result.body));
  assert.equal(result.data.condition, null);
  assert.equal(result.data.goal.version, saved.data.goal.version);
  assert.equal((await repository.getTask(owner, open.id))?.scheduledFor, tuesday);
  assert.deepEqual(await repository.getTask(owner, finished.id), originalFact);
  assert.equal((await repository.getTask(owner, otherTask.id))?.scheduledFor, tuesday);
});

test("joint date moves preserve the source subject and apply its existing weekly limit", async () => {
  const { call, arrange, move, repository } = await fixture();
  const g = await call("goals", "POST", { title: "Scoped work", constraints: {} });
  assert.equal(g.statusCode, 201, JSON.stringify(g.body));
  const goal_id = g.data.id;
  const subject_id = "reading";
  const subject = await call("goals/" + goal_id + "/subjects", "PATCH", { base_version: 0, subjects: [
    { id: subject_id, title: "Reading", outcome_criteria: "One paragraph", priority: "high", weekly_minutes: 25, archived: false },
  ] });
  assert.equal(subject.statusCode, 200, JSON.stringify(subject.body));
  const nextWeek = "2026-12-07";
  const plan = await arrange([["This week", monday, 20], ["Next week", nextWeek, 20]],
    { goal_id, subject_id, period_end: "2026-12-13" });
  const [first] = plan.tasks;
  const input = { period_start: monday, period_end: "2026-12-13", condition: null, moves: [move(first, nextWeek)] };
  const path = "goals/" + goal_id + "/conditions";
  const reviewed = await call(path + "/preview", "POST", input);
  assert.equal(reviewed.statusCode, 200, JSON.stringify(reviewed.body));
  assert.equal(reviewed.data.block_reason, "over_limit");
  assert.equal(reviewed.data.tasks.find((task: { task_id: string }) => task.task_id === first.id).subject_title, "Reading");
  const scope = reviewed.data.weeks.find((week: { scope: string }) => week.scope === "subject");
  assert.equal(scope.subject_id, subject_id);
  assert.equal(scope.projected_minutes, 40);
  assert.equal(scope.shortfall_minutes, 15);
  assert.equal((await call(path + "/apply", "POST", { ...input, preview_revision: reviewed.data.preview_revision })).statusCode, 422);
  assert.equal((await repository.getTask(owner, first.id))?.scheduledFor, monday);
});

test("a paused goal can review and save a historical condition without moving work", async () => {
  const { call, arrange, conditionFor, move, repository } = await fixture();
  const plan = await arrange([["Keep this action", monday, 20]]);
  const task = plan.tasks[0], goalPath = "goals/" + plan.goal_id, path = goalPath + "/conditions";
  const goal = await repository.getGoal(owner, plan.goal_id);
  const pause = await call(goalPath + "/lifecycle", "POST", { base_version: goal!.version, action: "pause", reason: "Busy" });
  assert.equal(pause.statusCode, 200, JSON.stringify(pause.body));
  const then = "2026-11-24";
  const condition = { ...conditionFor(pause.data.version, 10), scope: "temporary", starts_on: then, ends_on: then };
  const input = { period_start: then, period_end: then, condition, moves: [] };
  const preview = await call(path + "/preview", "POST", input);
  assert.equal(preview.statusCode, 200, JSON.stringify(preview.body));
  assert.equal(preview.data.can_apply, true);
  assert.equal(preview.data.days[0].blocking, false);
  const saved = await call(path + "/apply", "POST", { ...input, preview_revision: preview.data.preview_revision });
  assert.equal(saved.statusCode, 200, JSON.stringify(saved.body));
  assert.deepEqual(saved.data.moved_tasks, []);
  assert.equal(saved.data.condition.starts_on, then);
  assert.equal(saved.data.goal.status, "paused");
  assert.equal((await call(path + "/preview", "POST", { period_start: monday, period_end: end, condition: null,
    moves: [move(task, tuesday)] })).code, "LIGHTTICK_STATE_TRANSITION_INVALID");
  assert.equal((await repository.getTask(owner, task.id))?.scheduledFor, monday);
});
