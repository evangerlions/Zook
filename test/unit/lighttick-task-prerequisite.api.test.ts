import assert from "node:assert/strict";
import test from "node:test";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { LightTickTaskPrerequisiteEnvelopeSchema, LightTickTodayDataSchema } from "../../src/generated/openapi/public-contracts.generated.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { LightTickProposalService } from "../../src/modules/lighttick/lighttick-proposal.service.ts";
import { LightTickTaskService } from "../../src/modules/lighttick/lighttick-task.service.ts";
import { LightTickTodayService } from "../../src/modules/lighttick/lighttick-today.service.ts";
import type { ManualDraft } from "../../src/modules/lighttick/manual/manual-planning.types.ts";
import type { HttpRequest } from "../../src/shared/types.ts";
import { createApplication } from "../support/create-test-application.ts";

const appId = "lighttick";
const owner = { appId, userId: "user_alice" };
const monday = "2026-11-30", sunday = "2026-12-06";
const start = new Date("2026-11-29T16:30:00Z");
const stamps = { createdAt: start.toISOString(), updatedAt: start.toISOString() };

async function fixture() {
  let now = start;
  const seed = buildDefaultSeed(undefined, { includeLightTick: true });
  for (const userId of [owner.userId, "user_bob"]) {
    seed.appUsers.push({ id: "dependency-" + userId, appId, userId, status: "ACTIVE", accountRegion: "UNKNOWN", joinedAt: now.toISOString() });
  }
  const { app, services: { lighttickRuntime: runtime, tokenService } } = await createApplication({ seed, lighttickEnabled: true });
  const repository = runtime.repository;
  runtime.today = new LightTickTodayService(repository, () => now);
  runtime.tasks = new LightTickTaskService(repository, () => now);
  runtime.proposals = new LightTickProposalService(repository, () => now);
  let sequence = 0;
  async function call(path: string, method: HttpRequest["method"] = "GET", body?: HttpRequest["body"],
    { key, userId = owner.userId as string | null }: { key?: string; userId?: string | null } = {}) {
    const response = await app.handle({ path: "/api/v1/lighttick/" + path, method, query: {}, body, headers: {
      ...(userId ? { authorization: "Bearer " + tokenService.issueAccessToken(userId, appId) } : {}),
      "x-app-id": appId, "x-lighttick-task-schema": "2", "idempotency-key": key ?? "prerequisite-" + (++sequence),
    } });
    return { ...response, ...response.body as { data: any; code: string } };
  }
  await call("profile", "PATCH", { base_version: 0, timezone: "Asia/Shanghai" });
  const draft = (titles: string[], fields: Partial<ManualDraft> = {}, userId?: string) => call("manual-plans", "POST", {
    title: "Practice plan", period_start: monday, period_end: sunday, completion_criteria: "Clear result",
    tasks: titles.map((title, index) => ({ id: "action-" + index, title, scheduled_for: monday, estimated_minutes: 10,
      completion_criteria: "One note", guidance: "" })), ...fields,
  }, { userId });
  async function confirm(titles: string[], userId?: string) {
    const proposal = await draft(titles, {}, userId);
    assert.equal(proposal.statusCode, 200, JSON.stringify(proposal.body));
    const result = await call("manual-plans/" + proposal.data.id + "/confirm", "POST",
      { base_version: proposal.data.version, goal_base_version: proposal.data.goal_version }, { userId });
    assert.equal(result.statusCode, 200, JSON.stringify(result.body));
    return result.data;
  }
  const task = (id: string, action: string, body: Record<string, unknown>) => call("tasks/" + id + "/" + action, "POST", body);
  const prerequisite = (id: string, userId?: string | null) => call("tasks/" + id + "/prerequisite", "GET", undefined, { userId });
  const set = (taskId: string, base_version: number, prerequisite_task_id: string | null, key?: string) =>
    call("tasks/" + taskId + "/prerequisite", "PUT", { base_version, prerequisite_task_id }, { key });
  return { call, draft, confirm, task, prerequisite, set, repository, advance: (date: Date) => { now = date; } };
}

test("the task prerequisite protects online, offline and step progress until the original source completes", async () => {
  const { call, draft, confirm, task, prerequisite, set, repository, advance } = await fixture();
  const plan = await confirm(["Write a draft", "Read the source", "Review a separate item"]);
  const [target, source, other] = plan.tasks;
  const stepId = "dependency-step";
  await repository.saveTaskStep({ ...owner, ...stamps, id: stepId, taskId: target.id, position: 1, title: "Write the first sentence",
    completed: false, version: 1 });
  const initial = await prerequisite(target.id);
  assert.equal(initial.statusCode, 200);
  assert.equal(initial.data.editable, true);
  assert.equal(initial.data.prerequisite, null);
  assert.deepEqual(initial.data.choices.map((choice: { task_id: string }) => choice.task_id).sort(), [source.id, other.id].sort());
  assert.equal((await prerequisite(target.id, null)).statusCode, 401);
  assert.equal((await prerequisite(target.id, "user_bob")).statusCode, 404);
  const assigned = await set(target.id, target.version, source.id, "stable-link-receipt");
  assert.equal(assigned.statusCode, 200, JSON.stringify(assigned.body));
  assert.equal(assigned.headers?.["Cache-Control"], "no-store");
  const ajv = new Ajv2020({ strict: false });
  addFormats(ajv);
  const validate = ajv.compile(LightTickTaskPrerequisiteEnvelopeSchema);
  assert.equal(validate(assigned.body), true, JSON.stringify(validate.errors));
  assert.deepEqual(assigned.data.prerequisite, { task_id: source.id, title: source.title, state: "waiting" });
  assert.deepEqual((await set(target.id, target.version, source.id, "stable-link-receipt")).data, assigned.data);
  assert.equal((await set(target.id, target.version, null, "stable-link-receipt")).code, "LIGHTTICK_IDEMPOTENCY_MISMATCH");
  assert.equal((await set(target.id, target.version, null)).code, "LIGHTTICK_VERSION_CONFLICT");

  const version = assigned.data.task_version;
  const base = { base_version: version };
  const original = await repository.getTask(owner, target.id);
  for (const [action, command] of [
    ["start", base], ["complete", { ...base, actual_duration_minutes: 15 }],
    ["progress", { ...base, action: "record_partial", outcome: "Attempted anyway" }],
    ["steps/" + stepId, { ...base, completed: true }],
  ] as const) {
    const blocked = await task(target.id, action, command);
    assert.equal(blocked.statusCode, 409, JSON.stringify(blocked.body));
    assert.equal(blocked.code, "LIGHTTICK_TASK_PREREQUISITE_BLOCKED");
  }
  const sync = await call("sync/push", "POST", { operations: ["start", "complete"].map(action => ({
    operation_id: "offline-dependency-" + action, device_id: "dependency-client", entity_type: "task", entity_id: target.id,
    action, base_version: version, client_occurred_at: start.toISOString(), payload: {},
  })) });
  assert.equal(sync.statusCode, 200, JSON.stringify(sync.body));
  assert.deepEqual(sync.data.results.map((result: { error_code: string; status: string }) => [result.error_code, result.status]),
    [["LIGHTTICK_TASK_PREREQUISITE_BLOCKED", "rejected"], ["LIGHTTICK_TASK_PREREQUISITE_BLOCKED", "rejected"]]);
  const forgedReplacement = await draft(["Replace the blocked action"], {
    goal_id: plan.goal_id, replace_tasks: [{ id: target.id, version }],
  });
  assert.equal(forgedReplacement.code, "LIGHTTICK_TASK_PREREQUISITE_BLOCKED");
  assert.equal((await repository.getTaskStep(owner, target.id, stepId))?.completed, false);
  assert.deepEqual(await repository.getTask(owner, target.id), original);
  const estimate = await task(target.id, "progress", { ...base, action: "set_remaining", remaining_estimated_minutes: 8 });
  assert.equal(estimate.statusCode, 200, JSON.stringify(estimate.body));
  const otherLink = await set(other.id, other.version, source.id);
  assert.equal(otherLink.statusCode, 200, JSON.stringify(otherLink.body));
  assert.equal((await task(source.id, "complete", { base_version: source.version })).statusCode, 200);
  const otherStarted = await task(other.id, "start", { base_version: otherLink.data.task_version });
  assert.equal(otherStarted.statusCode, 200, JSON.stringify(otherStarted.body));
  assert.equal((await prerequisite(target.id)).data.prerequisite.state, "complete");
  const started = await task(target.id, "start", { base_version: estimate.data.task.version });
  assert.equal(started.statusCode, 200, JSON.stringify(started.body));
  assert.equal((await set(target.id, started.data.version, null)).code, "LIGHTTICK_STATE_TRANSITION_INVALID");

  // Use the same original task after its due date, retaining start and remaining effort.
  advance(new Date("2026-12-02T16:30:00Z"));
  const moved = await task(target.id, "reschedule", { base_version: started.data.version, target_date: "2026-12-03" });
  assert.equal(moved.statusCode, 200, JSON.stringify(moved.body));
  assert.equal((await repository.getTask(owner, other.id))?.executionProgress, undefined);
  const otherMoved = await task(other.id, "reschedule", { base_version: otherStarted.data.version, target_date: "2026-12-03" });
  assert.equal(otherMoved.statusCode, 200, JSON.stringify(otherMoved.body));
  assert.equal((await repository.getTask(owner, other.id))?.startedAt, start.toISOString());
  const completed = await task(target.id, "complete", { base_version: moved.data.version, actual_duration_minutes: 7 });
  assert.equal(completed.statusCode, 200, JSON.stringify(completed.body));
  const saved = await repository.getTask(owner, target.id);
  assert.equal(saved?.scheduledFor, "2026-12-03");
  assert.equal(saved.startedAt, start.toISOString());
  assert.equal(saved.actualMinutes, 7);
});

test("invalid sources and cycles are rejected, source removal stays blocked, and reviewed plan changes preserve exact IDs", async () => {
  const { call, confirm, task, prerequisite, set, repository } = await fixture();
  const plan = await confirm(["Target", "Selected source", "Alternative"]);
  const [target, source, alternate] = plan.tasks;
  const [otherGoal] = (await confirm(["Other plan"])).tasks;
  const [otherOwner] = (await confirm(["Other owner's task"], "user_bob")).tasks;
  for (const id of [target.id, otherGoal.id, otherOwner.id]) {
    const invalid = await set(target.id, target.version, id);
    assert.equal(invalid.statusCode, 422);
    assert.equal(invalid.code, "LIGHTTICK_TASK_PREREQUISITE_INVALID");
  }
  const linked = await set(target.id, target.version, source.id);
  assert.equal(linked.statusCode, 200, JSON.stringify(linked.body));
  assert.equal((await set(source.id, source.version, target.id)).code, "LIGHTTICK_TASK_PREREQUISITE_INVALID");
  const first = await task(source.id, "skip", { base_version: source.version, reason_code: "no_time" });
  assert.equal(first.statusCode, 200, JSON.stringify(first.body));
  assert.deepEqual((await prerequisite(target.id)).data.prerequisite, { task_id: source.id, title: source.title, state: "unavailable" });
  assert.equal((await task(target.id, "complete", { base_version: linked.data.task_version })).code,
    "LIGHTTICK_TASK_PREREQUISITE_BLOCKED");
  const chosen = await set(target.id, linked.data.task_version, alternate.id);
  assert.equal(chosen.statusCode, 200, JSON.stringify(chosen.body));
  assert.equal((await task(alternate.id, "complete", { base_version: alternate.version })).statusCode, 200);
  const livePlan = await repository.getPlan(owner, target.plan_id);
  assert.ok(livePlan);
  const change = await repository.saveProposal({ ...owner, ...stamps, id: "prerequisite-review-diff", planId: livePlan.id,
    status: "pending", version: 1, basePlanVersion: livePlan.version, reason: "Adjust effort", impact: {},
    diff: [{ action: "update_task", task_id: target.id, estimated_minutes: 9 }], expiresAt: "2026-12-06T23:00:00Z" });
  const accepted = await call("change-proposals/" + change.id + "/accept", "POST", { base_version: change.version });
  assert.equal(accepted.statusCode, 200, JSON.stringify(accepted.body));
  const preserved = await repository.getTask(owner, target.id);
  assert.ok(preserved && preserved.planId !== livePlan.id);
  assert.equal(preserved.prerequisiteTaskId, alternate.id);
  assert.equal((await prerequisite(target.id)).data.prerequisite.state, "complete");
  const cleared = await set(target.id, preserved.version, null);
  assert.equal(cleared.statusCode, 200, JSON.stringify(cleared.body));
  assert.equal(cleared.data.prerequisite, null);
  assert.equal((await repository.getTask(owner, alternate.id))?.status, "completed");
});

test("undated waiting and ready rows use a null date and rebooking keeps the started task", async () => {
  const { call, draft, task, set, repository } = await fixture();
  const proposal = await draft([], { tasks: [
    { id: "undated-dependent", title: "Write a first note", scheduled_for: null,
      estimated_minutes: 10, completion_criteria: "One note", guidance: "" },
    { id: "dated-source", title: "Read first", scheduled_for: monday,
      estimated_minutes: 10, completion_criteria: "Read the example", guidance: "" },
  ] });
  assert.equal(proposal.statusCode, 200, JSON.stringify(proposal.body));
  const confirmed = await call("manual-plans/" + proposal.data.id + "/confirm", "POST", {
    base_version: proposal.data.version, goal_base_version: proposal.data.goal_version,
  });
  assert.equal(confirmed.statusCode, 200, JSON.stringify(confirmed.body));
  const [dependent, source] = confirmed.data.tasks;
  const linked = await set(dependent.id, dependent.version, source.id);
  assert.equal(linked.statusCode, 200, JSON.stringify(linked.body));
  const ajv = new Ajv2020({ strict: false });
  addFormats(ajv);
  const validate = ajv.compile(LightTickTodayDataSchema);
  const waiting = (await call("today")).data;
  assert.equal(waiting.prerequisite_waiting_tasks[0].scheduled_date, null);
  assert.equal(validate(waiting), true, JSON.stringify(validate.errors));
  assert.equal((await task(source.id, "complete", { base_version: source.version })).statusCode, 200);
  const started = await task(dependent.id, "start", { base_version: linked.data.task_version });
  assert.equal(started.statusCode, 200, JSON.stringify(started.body));
  assert.equal((await repository.getTask(owner, dependent.id))?.executionProgress, undefined);
  const ready = (await call("today")).data;
  assert.equal(ready.prerequisite_ready_tasks[0].scheduled_date, null);
  assert.equal(ready.prerequisite_ready_tasks[0].prerequisite_reschedule_through, sunday);
  assert.equal(validate(ready), true, JSON.stringify(validate.errors));
  const rebooked = await task(dependent.id, "reschedule", { base_version: started.data.version, target_date: monday });
  assert.equal(rebooked.statusCode, 200, JSON.stringify(rebooked.body));
  assert.equal(rebooked.data.id, dependent.id);
  assert.equal(rebooked.data.status, "in_progress");
  assert.equal((await repository.getTask(owner, dependent.id))?.startedAt, start.toISOString());
});
