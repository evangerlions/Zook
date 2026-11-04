import assert from "node:assert/strict";
import test from "node:test";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { createApplication } from "../support/create-test-application.ts";
import { LightTickAiRunner } from "../../src/modules/lighttick/ai/lighttick-ai-runner.ts";
import { LightTickWorker } from "../../src/modules/lighttick/lighttick-worker.ts";
import { GoalConditionsService } from "../../src/modules/lighttick/goal-context/goal-conditions.service.ts";
import type { InMemoryJobQueue } from "../../src/infrastructure/queue/bullmq/in-memory-queue.ts";

const owner = { appId: "lighttick", userId: "user_alice" } as const;
const start = "2030-01-01", end = "2030-01-07";
type Receipt = { suffix: string; method: "POST" | "PATCH"; body: any; key: string; response: any };

async function reviewedFlow(options: { confirm?: boolean; dailyMinutes?: number; timezone?: string } = {}) {
  const seed = buildDefaultSeed(undefined, { includeLightTick: true });
  for (const userId of ["user_alice", "user_bob"]) seed.appUsers.push({ id: `disabled-planning-${userId}`, appId: "lighttick", userId,
    status: "ACTIVE", accountRegion: "UNKNOWN", joinedAt: new Date().toISOString() });
  const app = await createApplication({ seed, lighttickEnabled: true });
  const runtime = app.services.lighttickRuntime!, repository = runtime.repository;
  runtime.planningEnabled = true;
  const call = (suffix: string, method: any = "GET", body?: unknown, key = "read", userId: string | null = owner.userId) => app.app.handle({
    method, path: "/api/v1/lighttick/planning-sessions" + suffix, body,
    headers: { ...(userId ? { authorization: "Bearer " + app.services.tokenService.issueAccessToken(userId, "lighttick") } : {}),
      "x-lighttick-task-schema": "2", "idempotency-key": key },
  });
  const created = await runtime.goals.create(owner, { title: "Reviewed example", constraints: { weekly_available_minutes: 30 } });
  const now = new Date().toISOString();
  if (options.timezone) await repository.saveProfile({ ...owner, timezone: options.timezone, locale: "zh-CN", pace: "balanced",
    onboardingState: "completed", notificationPreferences: {}, onboardingDraft: {}, version: 1, createdAt: now, updatedAt: now });
  const goal = await repository.saveGoal({ ...created, status: "active" }, {
    event: { ...owner, id: "fixture-active-goal", aggregateType: "goal", aggregateId: created.id, eventType: "fixture_activated",
      aggregateVersion: created.version + 1, payload: {}, occurredAt: now, createdAt: now },
    change: { ...owner, entityType: "goal", entityId: created.id, entityVersion: created.version + 1, operation: "upsert", changedAt: now },
  }, created.version);
  if (options.dailyMinutes !== undefined) await new GoalConditionsService(repository).confirm(owner, goal.id, "daily-condition", {
    id: "daily-condition", base_version: goal.version, condition_version: 0, scope: "ongoing", starts_on: start,
    ends_on: null, daily_minutes: options.dailyMinutes, active: true, reason: "Synthetic daily availability",
  });
  const receipts: Receipt[] = [];
  const accepted = async (suffix: string, method: "POST" | "PATCH", body: any, key: string, status = 200) => {
    const response = await call(suffix, method, body, key);
    assert.equal(response.statusCode, status, JSON.stringify(response.body));
    receipts.push({ suffix, method, body: structuredClone(body), key, response: structuredClone(response.body.data) });
    return response.body.data as any;
  };
  let session: any = (await accepted("", "POST", { goal_id: goal.id }, "saved-create", 201)).session;
  session = (await accepted(`/${session.id}/context`, "PATCH", { base_version: session.version, fields: {
    period_start: { value: start, source: "confirmed" }, period_end: { value: end, source: "confirmed" },
  } }, "saved-context")).session;
  let providerCalls = 0;
  runtime.worker = new LightTickWorker(new LightTickAiRunner(repository, { complete: async (input: any) => {
    providerCalls++;
    const clarify = input.messages.some((message: any) => message.content.includes('"planning_action":"messages"'));
    return { provider: "synthetic", providerModel: "synthetic", text: JSON.stringify(clarify
      ? { message: "Review the existing window before continuing.", fields: {} }
      : { tasks: [{ title: "Generated example", estimated_minutes: 4, scheduled_for: start }] }) };
  } } as any));
  const clarification = await accepted(`/${session.id}/messages`, "POST", { base_version: session.version, message: "Keep the reviewed window." }, "saved-message", 202);
  await app.queue.processDueJobs(job => runtime.worker!.process(job), new Date("2035-01-01"));
  session = (await call(`/${session.id}`)).body.data;
  const generation = await accepted(`/${session.id}/drafts`, "POST", { base_version: session.version, context_revision: session.context_revision, deep_planning: true }, "saved-generation", 202);
  await app.queue.processDueJobs(job => runtime.worker!.process(job), new Date("2035-01-01"));
  session = (await call(`/${session.id}`)).body.data;
  assert.equal(session.status, "draft_ready");
  let plan = (await repository.getPlan(owner, session.draft_plan_id))!;
  session = (await accepted(`/${session.id}/draft`, "PATCH", { base_version: session.version, context_revision: session.context_revision,
    draft_plan_id: plan.id, plan_version: plan.version, tasks: [{ title: "Reviewed example", estimated_minutes: 5, scheduled_for: start }] }, "saved-edit")).session;
  plan = (await repository.getPlan(owner, session.draft_plan_id))!;
  if (options.confirm !== false) session = (await accepted(`/${session.id}/confirm`, "POST", { base_version: session.version,
    context_revision: session.context_revision, draft_plan_id: plan.id, plan_version: plan.version }, "saved-confirmation")).session;
  const runIds = [clarification.run.id, generation.run.id];
  const snapshot = async () => ({ goals: await repository.listGoals(owner), plans: await repository.listPlans(owner), tasks: await repository.listTasks(owner),
    session: await repository.getPlanningSession(owner, session.id), runs: await Promise.all(runIds.map(id => repository.getAiRun(owner, id))),
    messages: await repository.listChatMessages(owner, session.thread_id, 100, goal.id), events: await repository.listExecutionEvents(owner),
    changes: await repository.pullChanges(owner, 0, 1000), queue: structuredClone((app.queue as InMemoryJobQueue).jobs), providerCalls,
    receipts: await Promise.all(receipts.map(receipt => repository.getOperation(owner, `planning:${receipt.key}`))) });
  const edit = (tasks: unknown) => ({ base_version: session.version, context_revision: session.context_revision,
    draft_plan_id: plan.id, plan_version: plan.version, tasks });
  return { app, runtime, repository, call, goal, session, plan, receipts, snapshot, edit };
}

test("disabled planning retains authenticated GET access to current session and draft", async () => {
  const f = await reviewedFlow({ confirm: false });
  const expected = (await f.call(`/${f.session.id}`)).body.data;
  f.runtime.planningEnabled = false;
  const before = await f.snapshot(), response = await f.call(`/${f.session.id}`);
  assert.equal(response.statusCode, 200, JSON.stringify(response.body)); assert.deepEqual(response.body.data, expected);
  assert.equal((await f.call(`/${f.session.id}`, "GET", undefined, "foreign-read", "user_bob")).statusCode, 404);
  assert.equal((await f.call(`/${f.session.id}`, "GET", undefined, "anonymous-read", null)).statusCode, 401);
  assert.deepEqual(await f.snapshot(), before);
});

for (const worker of ["available", "absent"] as const) {
  test(`disabled planning replays all accepted receipts with worker ${worker} without enqueue or materialization`, async () => {
    const f = await reviewedFlow();
    f.runtime.planningEnabled = false;
    if (worker === "absent") f.runtime.jobs = undefined;
    const before = await f.snapshot();
    for (const receipt of f.receipts) {
      const replay = await f.call(receipt.suffix, receipt.method, receipt.body, receipt.key);
      assert.ok([200, 201, 202].includes(replay.statusCode), JSON.stringify(replay.body));
      assert.deepEqual(replay.body.data, receipt.response);
    }
    assert.deepEqual(await f.snapshot(), before);
    await f.app.queue.processDueJobs(job => f.runtime.worker!.process(job), new Date("2035-01-01"));
    assert.deepEqual(await f.snapshot(), before);
    assert.equal((await f.repository.listTasks(owner)).length, 1);
  });
}

test("disabled planning rejects every fresh mutation and never saves a receipt", async () => {
  const f = await reviewedFlow(); f.runtime.planningEnabled = false;
  const before = await f.snapshot();
  for (const receipt of f.receipts) {
    const key = `fresh-${receipt.key}`, response = await f.call(receipt.suffix, receipt.method, receipt.body, key);
    assert.equal(response.statusCode, 503, JSON.stringify(response.body));
    assert.equal(await f.repository.getOperation(owner, `planning:${key}`), undefined);
  }
  assert.deepEqual(await f.snapshot(), before);
});

test("disabled planning cannot reuse an owned receipt for a changed payload or another session", async () => {
  const f = await reviewedFlow(); f.runtime.planningEnabled = false;
  const before = await f.snapshot();
  for (const receipt of f.receipts) {
    const body = receipt.suffix === "" ? { goal_id: "another-goal" } : { ...receipt.body, base_version: 999 };
    assert.equal((await f.call(receipt.suffix, receipt.method, body, receipt.key)).statusCode, 409);
  }
  const edit = f.receipts.find(receipt => receipt.key === "saved-edit")!;
  assert.equal((await f.call("/another-session/draft", "PATCH", edit.body, edit.key)).statusCode, 409);
  assert.deepEqual(await f.snapshot(), before);
});

test("an accepted receipt cannot cross owners while disabled or when writes are re-enabled", async () => {
  const f = await reviewedFlow(); f.runtime.planningEnabled = false;
  const before = await f.snapshot();
  for (const receipt of f.receipts) {
    assert.equal((await f.call(receipt.suffix, receipt.method, receipt.body, receipt.key, "user_bob")).statusCode, 503);
    assert.equal(await f.repository.getOperation({ ...owner, userId: "user_bob" }, `planning:${receipt.key}`), undefined);
  }
  assert.equal((await f.call(`/${f.session.id}`, "GET", undefined, "foreign-read", "user_bob")).statusCode, 404);
  f.runtime.planningEnabled = true;
  for (const receipt of f.receipts) assert.equal((await f.call(receipt.suffix, receipt.method, receipt.body, receipt.key, "user_bob")).statusCode, 404);
  assert.deepEqual(await f.repository.listGoals({ ...owner, userId: "user_bob" }), []);
  assert.deepEqual(await f.repository.listTasks({ ...owner, userId: "user_bob" }), []);
  assert.deepEqual(await f.snapshot(), before);
});

test("draft edits still enforce daily capacity and roll back under an enabled flag", async () => {
  const f = await reviewedFlow({ confirm: false, dailyMinutes: 10 });
  const before = await f.snapshot(), response = await f.call(`/${f.session.id}/draft`, "PATCH", f.edit([
    { title: "Over daily capacity", estimated_minutes: 15, scheduled_for: start },
  ]), "over-capacity-edit");
  assert.equal(response.statusCode, 422, JSON.stringify(response.body));
  assert.deepEqual(await f.snapshot(), before);
});

for (const lifecycle of ["pause", "complete", "archive"] as const) {
  test(`draft edits cannot write after goal ${lifecycle}`, async () => {
    const f = await reviewedFlow({ confirm: false });
    await f.runtime.goals.transition(owner, f.goal.id, (await f.runtime.goals.get(owner, f.goal.id)).version, lifecycle);
    const before = await f.snapshot(), response = await f.call(`/${f.session.id}/draft`, "PATCH", f.edit([
      { title: "Cached edit", estimated_minutes: 5, scheduled_for: start },
    ]), "stopped-edit");
    assert.equal(response.statusCode, 409, JSON.stringify(response.body));
    assert.deepEqual(await f.snapshot(), before);
  });
}

for (const timestamp of ["2030-01-01T00:30:00+14:00", "2030-01-07T23:30:00-12:00"]) {
  test(`draft edit rejects an ISO timestamp whose UTC business day escapes its reviewed window (${timestamp})`, async () => {
    const f = await reviewedFlow({ confirm: false, dailyMinutes: 10 });
    const before = await f.snapshot();
    // The owner has no profile, so the authoritative business timezone is UTC.
    // String-prefix checks alone accept these despite their real dates being Dec 31 / Jan 8.
    const response = await f.call(`/${f.session.id}/draft`, "PATCH", f.edit([
      { title: "Outside the reviewed local window", estimated_minutes: timestamp.includes("+14") ? 15 : 5, scheduled_for: timestamp },
    ]), "offset-window-edit");
    assert.equal(response.statusCode, 422, JSON.stringify(response.body));
    assert.deepEqual(await f.snapshot(), before);
    assert.equal(await f.repository.getOperation(owner, "planning:offset-window-edit"), undefined);
  });
}

test("a timestamp inside the owner's first business day remains editable and confirmable despite its earlier UTC date prefix", async () => {
  const f = await reviewedFlow({ confirm: false, dailyMinutes: 10, timezone: "Asia/Shanghai" });
  // This instant is Jan 1, 07:30 in the owner's timezone, within the approved Jan 1–7 window.
  const timestamp = "2029-12-31T23:30:00.000Z";
  const edited = await f.call(`/${f.session.id}/draft`, "PATCH", f.edit([
    { title: "Valid first local morning", estimated_minutes: 5, scheduled_for: timestamp },
  ]), "valid-business-day-edit");
  assert.equal(edited.statusCode, 200, JSON.stringify(edited.body));
  assert.equal((await f.repository.listTasks(owner)).length, 0);
  const session: any = (edited.body.data as any).session, plan = (await f.repository.getPlan(owner, session.draft_plan_id))!;
  const confirmed = await f.call(`/${session.id}/confirm`, "POST", { base_version: session.version, context_revision: session.context_revision,
    draft_plan_id: plan.id, plan_version: plan.version }, "valid-business-day-confirm");
  assert.equal(confirmed.statusCode, 200, JSON.stringify(confirmed.body));
  const tasks = await f.repository.listTasks(owner);
  assert.equal(tasks.length, 1); assert.equal(tasks[0].scheduledFor, timestamp);
});
