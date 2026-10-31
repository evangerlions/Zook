import assert from "node:assert/strict";
import test from "node:test";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { createApplication } from "../support/create-test-application.ts";
import { LightTickAiRunner } from "../../src/modules/lighttick/ai/lighttick-ai-runner.ts";
import { LightTickWorker } from "../../src/modules/lighttick/lighttick-worker.ts";
import { GoalConditionsService } from "../../src/modules/lighttick/goal-context/goal-conditions.service.ts";

const owner = { appId: "lighttick", userId: "user_alice" } as const;
const start = "2030-01-01", end = "2030-01-07";
const reviewedTasks = () => [
  { title: "Reviewed first action", estimated_minutes: 3, scheduled_for: start, priority: 2,
    completion_criteria: "A concrete example", steps: ["Open notes", "Explain one example"],
    guidance: { purpose: "Make the example usable", materials: ["My notes"], expected_output: "One explanation" } },
  { title: "Reviewed second action", estimated_minutes: 2, scheduled_for: "2030-01-02" },
];

async function setup(options: { budget?: number; dailyMinutes?: number; periodEnd?: string; generatedMinutes?: number } = {}) {
  const seed = buildDefaultSeed(undefined, { includeLightTick: true });
  for (const userId of ["user_alice", "user_bob"]) seed.appUsers.push({ id: `draft-edit-${userId}`, appId: "lighttick", userId,
    status: "ACTIVE", accountRegion: "UNKNOWN", joinedAt: new Date().toISOString() });
  const app = await createApplication({ seed, lighttickEnabled: true });
  const runtime = app.services.lighttickRuntime!, repository = runtime.repository;
  runtime.planningEnabled = true;
  const headers = { authorization: "Bearer " + app.services.tokenService.issueAccessToken(owner.userId, "lighttick"), "x-lighttick-task-schema": "2" };
  const call = (suffix: string, method: any = "GET", body?: unknown, key = "read", userId = owner.userId) => app.app.handle({
    method, path: "/api/v1/lighttick/planning-sessions" + suffix, body,
    headers: { ...headers, authorization: "Bearer " + app.services.tokenService.issueAccessToken(userId, "lighttick"), "idempotency-key": key },
  });
  const createdGoal = await runtime.goals.create(owner, { title: "Build a usable example", constraints: { weekly_available_minutes: options.budget ?? 30 } });
  // A pre-existing active goal with no current work; generation itself must remain inert.
  const goal = await repository.saveGoal({ ...createdGoal, status: "active" }, {
    event: { ...owner, id: "fixture-goal-active", aggregateType: "goal", aggregateId: createdGoal.id, eventType: "fixture_activated",
      aggregateVersion: createdGoal.version + 1, payload: {}, occurredAt: new Date().toISOString(), createdAt: new Date().toISOString() },
    change: { ...owner, entityType: "goal", entityId: createdGoal.id, entityVersion: createdGoal.version + 1, operation: "upsert", changedAt: new Date().toISOString() },
  }, createdGoal.version);
  if (options.dailyMinutes !== undefined) await new GoalConditionsService(repository).confirm(owner, goal.id, "private-condition", {
    id: "private-condition", condition_version: 0, base_version: goal.version, scope: "ongoing", starts_on: start, ends_on: null,
    daily_minutes: options.dailyMinutes, active: true, reason: "PRIVATE_HEALTH_REASON_NEVER_SEND_TO_MODEL",
  });
  const created = await call("", "POST", { goal_id: goal.id }, "create-session");
  assert.equal(created.statusCode, 201, JSON.stringify(created.body));
  let session: any = (created.body.data as any).session;
  const ready = await call(`/${session.id}/context`, "PATCH", { base_version: session.version, fields: {
    period_start: { value: start, source: "confirmed" }, period_end: { value: options.periodEnd ?? end, source: "user" },
  } }, "context-review");
  assert.equal(ready.statusCode, 200, JSON.stringify(ready.body)); session = (ready.body.data as any).session;
  const providerInputs: any[] = [];
  runtime.worker = new LightTickWorker(new LightTickAiRunner(repository, { complete: async (input: any) => {
    providerInputs.push(structuredClone(input));
    return { provider: "synthetic", providerModel: "synthetic", text: JSON.stringify({ tasks: [
      { title: "Generated action awaiting review", estimated_minutes: options.generatedMinutes ?? 4, scheduled_for: start },
    ] }) };
  } } as any));
  const queued = await call(`/${session.id}/drafts`, "POST", { base_version: session.version, context_revision: session.context_revision, deep_planning: true }, "generate-draft");
  assert.equal(queued.statusCode, 202, JSON.stringify(queued.body));
  const runId = (queued.body.data as any).run.id;
  await app.queue.processDueJobs(job => runtime.worker!.process(job), new Date("2035-01-01"));
  const fetched = await call(`/${session.id}`);
  assert.equal(fetched.statusCode, 200, JSON.stringify(fetched.body)); session = fetched.body.data as any;
  assert.equal(session.status, "draft_ready", JSON.stringify(session));
  const plan = (await repository.getPlan(owner, session.draft_plan_id))!;
  const edit = (tasks: unknown = reviewedTasks(), patch: Record<string, unknown> = {}) => ({
    base_version: session.version, context_revision: session.context_revision, draft_plan_id: plan.id, plan_version: plan.version, tasks, ...patch,
  });
  const confirmation = async () => {
    const current: any = (await call(`/${session.id}`)).body.data;
    const draft = (await repository.getPlan(owner, current.draft_plan_id))!;
    return { base_version: current.version, context_revision: current.context_revision, draft_plan_id: draft.id, plan_version: draft.version };
  };
  const snapshot = async () => ({ goals: await repository.listGoals(owner), plans: await repository.listPlans(owner),
    tasks: await repository.listTasks(owner), events: await repository.listExecutionEvents(owner),
    changes: await repository.pullChanges(owner, 0, 1000), session: await repository.getPlanningSession(owner, session.id),
    run: await repository.getAiRun(owner, runId) });
  const mutatePlan = async (patch: Record<string, unknown>) => repository.savePlan({ ...plan, ...patch }, {
    event: { ...owner, id: "fixture-plan-change", aggregateType: "plan", aggregateId: plan.id, eventType: "fixture_changed",
      aggregateVersion: plan.version + 1, payload: {}, occurredAt: new Date().toISOString(), createdAt: new Date().toISOString() },
    change: { ...owner, entityType: "plan", entityId: plan.id, entityVersion: plan.version + 1, operation: "upsert", changedAt: new Date().toISOString() },
  }, plan.version);
  return { app, runtime, repository, call, goal, session, plan, edit, confirmation, snapshot, mutatePlan, runId, providerInputs };
}

test("reviewed task PATCH keeps one draft, increments versions, stays inert, and schedules only on replayable confirmation", async () => {
  const f = await setup(), input = f.edit();
  const response = await f.call(`/${f.session.id}/draft`, "PATCH", input, "edit-reviewed-tasks");
  assert.equal(response.statusCode, 200, JSON.stringify(response.body));
  const edited: any = (response.body.data as any).session, plan = (await f.repository.getPlan(owner, f.plan.id))!;
  assert.equal(edited.draft_plan_id, f.plan.id);
  assert.equal(edited.version, f.session.version + 1); assert.equal(edited.context_revision, f.session.context_revision);
  assert.equal(plan.version, f.plan.version + 1); assert.equal(plan.status, "proposed");
  assert.equal((await f.repository.listPlans(owner)).length, 1); assert.deepEqual(await f.repository.listTasks(owner), []);
  assert.deepEqual((plan.proposal.tasks as any[]).map(t => [t.title, t.estimatedMinutes, t.scheduledFor]), reviewedTasks().map(t => [t.title, t.estimated_minutes, t.scheduled_for]));
  const beforeReplay = await f.snapshot();
  assert.deepEqual((await f.call(`/${f.session.id}/draft`, "PATCH", input, "edit-reviewed-tasks")).body.data, response.body.data);
  assert.deepEqual(await f.snapshot(), beforeReplay);
  const command = await f.confirmation();
  const first = await f.call(`/${f.session.id}/confirm`, "POST", command, "confirm-reviewed-tasks");
  assert.equal(first.statusCode, 200, JSON.stringify(first.body));
  assert.equal((first.body.data as any).session.status, "confirmed");
  const tasks = await f.repository.listTasks(owner);
  assert.equal(tasks.length, 2);
  const reviewed = tasks.find(t => t.title === "Reviewed first action")!;
  assert.equal(reviewed.completionCriteria, "A concrete example");
  assert.deepEqual(reviewed.guidance, reviewedTasks()[0].guidance);
  assert.deepEqual((await f.repository.listTaskSteps(owner, reviewed.id)).map(step => step.title), ["Open notes", "Explain one example"]);
  const after = await f.snapshot();
  assert.deepEqual((await f.call(`/${f.session.id}/confirm`, "POST", command, "confirm-reviewed-tasks")).body.data, first.body.data);
  assert.equal((await f.call(`/${f.session.id}/confirm`, "POST", command, "other-confirmation")).statusCode, 409);
  assert.deepEqual(await f.snapshot(), after);
});

for (const conflict of ["session version", "context revision", "draft id", "plan version", "goal version", "plan source", "session source"] as const) {
  test(`draft PATCH rejects stale ${conflict} without partial writes`, async () => {
    const f = await setup(); let patch: Record<string, unknown> = {};
    if (conflict === "session version") patch.base_version = f.session.version - 1;
    if (conflict === "context revision") patch.context_revision = f.session.context_revision - 1;
    if (conflict === "draft id") patch.draft_plan_id = "different-draft";
    if (conflict === "plan version") patch.plan_version = f.plan.version + 1;
    if (conflict === "goal version") await f.runtime.goals.update(owner, f.goal.id, (await f.runtime.goals.get(owner, f.goal.id)).version, { title: "Goal changed after review" });
    if (conflict === "plan source") patch.plan_version = (await f.mutatePlan({ source: "manual_native" })).version;
    if (conflict === "session source") patch.plan_version = (await f.mutatePlan({ proposal: { ...f.plan.proposal, planning_session_id: "another-session" } })).version;
    const before = await f.snapshot();
    const response = await f.call(`/${f.session.id}/draft`, "PATCH", f.edit(reviewedTasks(), patch), "conflicting-edit");
    assert.equal(response.statusCode, 409, JSON.stringify(response.body));
    assert.deepEqual(await f.snapshot(), before);
    assert.equal(await f.repository.getOperation(owner, "planning:conflicting-edit"), undefined);
  });
}

test("draft PATCH remains owner scoped", async () => {
  const f = await setup(), before = await f.snapshot();
  assert.equal((await f.call(`/${f.session.id}`, "GET", undefined, "foreign-read", "user_bob")).statusCode, 404);
  const response = await f.call(`/${f.session.id}/draft`, "PATCH", f.edit(), "foreign-edit", "user_bob");
  assert.equal(response.statusCode, 404, JSON.stringify(response.body));
  assert.deepEqual(await f.snapshot(), before);
});

for (const invalid of ["total budget", "outside window", "invalid priority", "invalid guidance"] as const) {
  test(`draft PATCH rejects ${invalid} and leaves the original draft intact`, async () => {
    const f = await setup(); const task: any = { ...reviewedTasks()[0] };
    if (invalid === "total budget") task.estimated_minutes = 31;
    if (invalid === "outside window") task.scheduled_for = "2030-02-01";
    if (invalid === "invalid priority") task.priority = "maximum";
    if (invalid === "invalid guidance") task.guidance = { arbitrary_private_field: "unsupported" };
    const before = await f.snapshot(), response = await f.call(`/${f.session.id}/draft`, "PATCH", f.edit([task]), "invalid-edit");
    assert.equal(response.statusCode, 422, JSON.stringify(response.body));
    assert.deepEqual(await f.snapshot(), before);
  });
}

test("an edit write followed by receipt failure rolls back both draft and session versions", async () => {
  const f = await setup(), before = await f.snapshot();
  const save = f.repository.saveOperation.bind(f.repository);
  f.repository.saveOperation = async row => {
    if (row.operationId === "planning:failed-edit") throw new Error("injected edit receipt failure");
    return save(row);
  };
  const failed = await f.call(`/${f.session.id}/draft`, "PATCH", f.edit(), "failed-edit");
  assert.equal(failed.statusCode, 500, JSON.stringify(failed.body));
  assert.deepEqual(await f.snapshot(), before);
  assert.equal(await f.repository.getOperation(owner, "planning:failed-edit"), undefined);
  f.repository.saveOperation = save;
  assert.equal((await f.call(`/${f.session.id}/draft`, "PATCH", f.edit(), "failed-edit")).statusCode, 200);
  assert.deepEqual(await f.repository.listTasks(owner), []);
});

test("legacy session confirmation independently revalidates stored draft total against the reviewed session budget", async () => {
  const f = await setup({ budget: 5 });
  // Reproduce an otherwise well-owned stored draft whose task payload changed after generation.
  await f.mutatePlan({ proposal: { ...f.plan.proposal, tasks: [{ title: "Changed stored action", estimatedMinutes: 6, scheduledFor: start }] } });
  const before = await f.snapshot(), response = await f.call(`/${f.session.id}/confirm`, "POST", await f.confirmation(), "over-budget-confirm");
  assert.equal(response.statusCode, 422, JSON.stringify(response.body));
  assert.deepEqual(await f.snapshot(), before);
});

test("PlanningSession sends effective daily numbers to the provider without private condition reasons or audit history", async () => {
  const f = await setup({ dailyMinutes: 10 });
  const run = (await f.repository.getAiRun(owner, f.runId))!;
  assert.ok(Array.isArray(run.inputContext.confirmed_daily_limits), "Planning must freeze the selected window's effective limits.");
  const limits = run.inputContext.confirmed_daily_limits as any[];
  assert.equal(limits.length, 7); assert.equal(limits[0].date, start); assert.equal(limits[0].minutes, 10);
  assert.equal(limits[0].condition_id, "private-condition"); assert.equal(limits[0].condition_version, 1);
  const prompt = JSON.stringify(f.providerInputs);
  assert.ok(prompt.includes("confirmed_daily_limits"));
  assert.equal(prompt.includes("PRIVATE_HEALTH_REASON_NEVER_SEND_TO_MODEL"), false);
  assert.equal(prompt.includes("confirmed_planning_conditions"), false);
  assert.equal(JSON.stringify(run.inputContext).includes("PRIVATE_HEALTH_REASON_NEVER_SEND_TO_MODEL"), false);
});

test("legacy PlanningSession confirmation enforces N3 daily capacity without any draft-edit route", async () => {
  const f = await setup({ dailyMinutes: 10, generatedMinutes: 15 });
  const before = await f.snapshot(), response = await f.call(`/${f.session.id}/confirm`, "POST", await f.confirmation(), "daily-limit-confirm");
  assert.equal(response.statusCode, 422, JSON.stringify(response.body));
  assert.deepEqual(await f.snapshot(), before);
});

for (const lifecycle of ["pause", "complete", "archive"] as const) {
  test(`legacy PlanningSession refuses confirmation after goal ${lifecycle}`, async () => {
    const f = await setup();
    await f.runtime.goals.transition(owner, f.goal.id, (await f.runtime.goals.get(owner, f.goal.id)).version, lifecycle);
    const before = await f.snapshot(), response = await f.call(`/${f.session.id}/confirm`, "POST", await f.confirmation(), "stopped-confirm");
    assert.equal(response.statusCode, 409, JSON.stringify(response.body));
    assert.deepEqual(await f.snapshot(), before);
  });
}

test("an existing 90-day session without daily conditions can still generate, edit and confirm", async () => {
  const f = await setup({ periodEnd: "2030-03-31" });
  const response = await f.call(`/${f.session.id}/draft`, "PATCH", f.edit(), "long-window-edit");
  assert.equal(response.statusCode, 200, JSON.stringify(response.body));
  assert.equal((await f.repository.listTasks(owner)).length, 0);
  const done = await f.call(`/${f.session.id}/confirm`, "POST", await f.confirmation(), "long-window-confirm");
  assert.equal(done.statusCode, 200, JSON.stringify(done.body));
  assert.equal((await f.repository.listTasks(owner)).length, 2);
});
