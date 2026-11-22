import assert from "node:assert/strict";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import * as contracts from "../../src/generated/openapi/public-contracts.generated.ts";
import { LightTickAiRunner } from "../../src/modules/lighttick/ai/lighttick-ai-runner.ts";
import { LightTickTodayService } from "../../src/modules/lighttick/lighttick-today.service.ts";
import { LightTickWorker } from "../../src/modules/lighttick/lighttick-worker.ts";
import { GoalRoadmapService } from "../../src/modules/lighttick/planning/goal-roadmap.ts";
import { createApplication } from "../support/create-test-application.ts";

const owner = { appId: "lighttick", userId: "user_alice" } as const;
const other = { appId: "lighttick", userId: "user_bob" } as const;
const fixedTime = "2026-11-24T17:00:00.000Z";

const stage = { id: "clear-conclusion", title: "练习先说结论", outcome_criteria: "能在三十秒内给出结论和一个事实",
  starts_on: "2026-11-24", ends_on: "2026-11-27" };

async function fixture() {
  const seed = buildDefaultSeed(undefined, { includeLightTick: true });
  for (const identity of [owner, other]) seed.appUsers.push({
    ...identity, id: "planning-entry-" + identity.userId, status: "ACTIVE",
    accountRegion: "UNKNOWN", joinedAt: fixedTime,
  });
  const app = await createApplication({ seed, lighttickEnabled: true });
  const runtime = app.services.lighttickRuntime!;
  runtime.planningEnabled = true;
  let instant = fixedTime;
  const clock = () => new Date(instant);
  runtime.today = new LightTickTodayService(runtime.repository, clock);
  let sequence = 0;
  const request = (
    path: string,
    args: { method?: string; body?: unknown; key?: string; identity?: typeof owner | typeof other | null;
      query?: Record<string, string> } = {},
  ) => {
    const { method = "GET", body, key = "planning-entry-" + ++sequence, identity = owner, query } = args;
    return app.app.handle({ method, path: "/api/v1/lighttick/" + path, query, body,
      headers: { "idempotency-key": key, ...(identity && {
        authorization: "Bearer " + app.services.tokenService.issueAccessToken(identity.userId, "lighttick"),
      }) } });
  };
  return { app, runtime, request, clock, setInstant: (value: string) => { instant = value; } };
}

test("a goal title creates exactly one draft and its planning session, with owner-scoped history", async () => {
  const f = await fixture();
  const endpoint = "planning-sessions";
  const ajv = new Ajv2020({ strict: false });
  addFormats(ajv);
  const validate = ajv.compile(contracts.LightTickPlanningCreateRequestSchema);
  for (const input of [{}, { goal_title: "Draft", goal_id: "goal-id" }, { goal_title: "Draft", previous_plan_id: "old-plan" }]) {
    assert.equal(validate(input), false);
    assert.equal((await f.request(endpoint, { method: "POST", body: input })).statusCode, 400);
  }
  assert.equal((await f.request(endpoint, { method: "POST", body: { goal_title: " " } })).statusCode, 400);
  assert.deepEqual(await f.runtime.repository.listGoals(owner), []);

  const newTitle = { goal_title: "  练习有证据的工作汇报  " };
  assert.equal(validate(newTitle), true);
  const create = { method: "POST" as const, body: newTitle, key: "stable-new-goal" };
  const [initial, duplicate] = await Promise.all([f.request(endpoint, create), f.request(endpoint, create)]);
  assert.equal(initial.statusCode, 201, JSON.stringify(initial.body));
  assert.deepEqual(initial.body.data, duplicate.body.data);
  const session = (initial.body.data as any).session;
  const [goal] = await f.runtime.repository.listGoals(owner);
  assert.equal(goal!.id, session.goal_id);
  assert.equal(goal!.title, newTitle.goal_title.trim());
  assert.equal(goal!.status, "draft");
  assert.equal((await f.runtime.repository.listGoals(owner)).length, 1);
  assert.deepEqual(await f.runtime.repository.listPlans(owner), []);
  assert.deepEqual(await f.runtime.repository.listTasks(owner), []);
  assert.equal((await f.request(endpoint, { ...create, body: { goal_title: "Another title" } })).statusCode, 409);

  f.setInstant("2026-11-24T17:10:00.000Z");
  await f.runtime.goals.update(owner, goal!.id, goal!.version, { title: "练习结构化汇报" });
  const existing = await f.request(endpoint, { method: "POST", body: { goal_id: goal!.id } });
  assert.equal(existing.statusCode, 201);
  const secondSession = (existing.body.data as any).session;
  assert.equal(secondSession.goal_id, session.goal_id);
  assert.equal((await f.runtime.repository.listGoals(owner)).length, 1);
  const foreign = await f.request(endpoint, { method: "POST", identity: other, body: { goal_title: "另一账号的计划" } });
  const foreignSession = (foreign.body.data as any).session;

  f.runtime.planningEnabled = false;
  const read = await f.request(endpoint, { query: { goal_id: goal!.id, limit: "1" } });
  assert.equal(read.statusCode, 200, JSON.stringify(read.body));
  const validateList = ajv.compile(contracts.LightTickPlanningSessionListEnvelopeSchema);
  assert.equal(validateList(read.body), true, JSON.stringify(validateList.errors));
  assert.deepEqual((read.body.data as any).items, [{
    id: secondSession.id, goal_id: goal!.id, goal_title: "练习结构化汇报", status: "collecting",
    draft_plan_id: null, draft_expires_at: null, updated_at: "2026-11-24T17:10:00.000Z",
  }]);
  assert.deepEqual(((await f.request(endpoint)).body.data as any).items.map((row: any) => row.id), [secondSession.id, session.id]);
  assert.deepEqual((await f.request(endpoint, { query: { goal_id: foreignSession.goal_id } })).body.data, { items: [] });
  assert.equal((await f.request(endpoint + "/" + foreignSession.id)).statusCode, 404);
  assert.equal((await f.request(endpoint, { identity: null })).statusCode, 401);
  assert.equal((await f.request(endpoint, { query: { limit: "101" } })).statusCode, 400);
  assert.deepEqual((await f.request(endpoint, create)).body.data, initial.body.data);
});

test("a prior confirmed plan seeds the next week's dates and remains readable after explicit confirmation", async () => {
  const f = await fixture();
  const { runtime } = f, repo = runtime.repository;
  await repo.saveProfile({
    ...owner, timezone: "Asia/Shanghai", locale: "zh-CN", pace: "balanced", onboardingState: "not_started",
    notificationPreferences: {}, onboardingDraft: {}, version: 1, createdAt: fixedTime, updatedAt: fixedTime,
  });
  const goal = await runtime.goals.create(owner, { title: "用事实总结每周工作", constraints: { weekly_available_minutes: 60 } });
  const differentGoal = await runtime.goals.create(owner, { title: "另一个目标", constraints: {} });
  const draft = await runtime.plans.createProposed(owner, {
    goalId: goal.id, granularity: "week", periodStart: "2026-11-17", periodEnd: "2026-11-23", source: "ai",
    tasks: [
      { title: "写出三项进展", estimatedMinutes: 10, scheduledFor: "2026-11-20" },
      { title: "整理原计划未完的卡点", estimatedMinutes: 12, scheduledFor: "2026-11-22" },
    ],
  });
  const wrongGoal = await f.request("planning-sessions", {
    method: "POST", body: { goal_id: differentGoal.id, previous_plan_id: draft.id },
  });
  assert.equal(wrongGoal.statusCode, 404);
  const command = { goal_id: goal.id, previous_plan_id: draft.id };
  const unconfirmed = await f.request("planning-sessions", { method: "POST", body: command });
  assert.equal(unconfirmed.statusCode, 409);
  const previous = await runtime.plans.confirm(owner, draft.id, draft.version);
  await runtime.tasks.command(owner, previous.tasks[0]!.id, previous.tasks[0]!.version, {
    action: "complete", actualMinutes: 9, notes: "原来的私人成果",
  });
  const existing = () => repo.listTasks(owner, draft.id);
  const history = await existing();

  assert.equal((await f.request("planning-sessions", { method: "POST", identity: other, body: command })).statusCode, 404);
  const created = await f.request("planning-sessions", { method: "POST", body: command, key: "follow-up-cycle" });
  const session = (created.body.data as any).session;
  assert.equal(created.statusCode, 201, JSON.stringify(created.body));
  assert.equal(session.previous_plan_id, draft.id);
  assert.deepEqual(session.context.period_start, { value: "2026-11-25", source: "imported" });
  assert.deepEqual(session.context.period_end, { value: "2026-12-01", source: "imported" });
  assert.deepEqual((await f.request("planning-sessions", { method: "POST", body: command, key: "follow-up-cycle" })).body.data, created.body.data);
  const summary = ((await f.request("planning-sessions", { query: { goal_id: goal.id } })).body.data as any).items[0];
  assert.equal(summary.previous_plan_id, draft.id);
  assert.equal(summary.period_start, "2026-11-25");
  assert.equal(summary.period_end, "2026-12-01");

  const sessionPath = "planning-sessions/" + session.id;
  assert.equal((await f.request(sessionPath + "/context", { method: "PATCH", body: {
    base_version: session.version, fields: { period_start: { value: "2026-11-23", source: "user" } },
  } })).statusCode, 400);
  assert.equal(((await f.request(sessionPath)).body.data as any).version, session.version);
  runtime.worker = new LightTickWorker(new LightTickAiRunner(repo, { complete: async () => ({
    provider: "synthetic", providerModel: "synthetic", text: JSON.stringify({ tasks: [
      { title: "写出三项进展", estimated_minutes: 10, scheduled_for: "2026-11-25", completion_criteria: "三项进展各有一个依据" },
    ] }),
  }) } as never, f.clock));
  const queued = await f.request(sessionPath + "/drafts", { method: "POST", body: {
    base_version: session.version, context_revision: session.context_revision, deep_planning: true,
  } });
  assert.equal(queued.statusCode, 202, JSON.stringify(queued.body));
  await f.app.queue.processDueJobs(job => runtime.worker!.process(job), new Date("2030-01-01"));
  const reviewed = (await f.request(sessionPath)).body.data as any;
  assert.equal(reviewed.status, "draft_ready", JSON.stringify(reviewed));
  const nextDraft = (await repo.getPlan(owner, reviewed.draft_plan_id))!;
  assert.equal(nextDraft.proposal.previous_plan_id, previous.plan.id);
  assert.deepEqual(await repo.listTasks(owner, nextDraft.id), []);
  assert.deepEqual(await existing(), history);

  const confirm = { method: "POST" as const, key: "confirm-next-cycle", body: {
    base_version: reviewed.version, context_revision: reviewed.context_revision, draft_plan_id: nextDraft.id, plan_version: nextDraft.version,
  } };
  const confirmed = await f.request(sessionPath + "/confirm", confirm);
  assert.equal(confirmed.statusCode, 200, JSON.stringify(confirmed.body));
  assert.deepEqual((await f.request(sessionPath + "/confirm", confirm)).body.data, confirmed.body.data);
  assert.deepEqual(await repo.getPlan(owner, draft.id), previous.plan);
  assert.deepEqual(await existing(), history);
  const [task] = await repo.listTasks(owner, nextDraft.id);
  assert.equal(task!.scheduledFor, "2026-11-25");
  assert.deepEqual((await runtime.today.get(owner)).executableTasks.map(item => item.id), [task!.id]);
  const stale = await f.request("planning-sessions", { method: "POST", body: command });
  assert.equal(stale.statusCode, 409);
  assert.equal(stale.body.code, "LIGHTTICK_PLANNING_STALE");
});

test("stage planning stays scoped from owner history through the reviewed draft and Today's task", async () => {
  const f = await fixture();
  const { runtime } = f, repo = runtime.repository;
  const roadmap = new GoalRoadmapService(repo, f.clock);
  await repo.saveProfile({
    ...owner, timezone: "Asia/Shanghai", locale: "zh-CN", pace: "balanced", onboardingState: "not_started",
    notificationPreferences: {}, onboardingDraft: {}, version: 1, createdAt: fixedTime, updatedAt: fixedTime,
  });
  const goal = await runtime.goals.create(owner, { title: "练习工作汇报", constraints: { weekly_available_minutes: 35 } });
  const another = await runtime.goals.create(owner, { title: "不同目标", constraints: {} });
  const setup = await roadmap.update(owner, goal.id, { base_version: 0, stages: [stage] });
  const achieved = await roadmap.recordOutcome(owner, goal.id, stage.id, { base_version: setup.version,
    state: "achieved", note: "PRIVATE_ACHIEVEMENT" });
  const path = "planning-sessions";
  const create = { method: "POST", body: { goal_id: goal.id, stage_id: stage.id }, key: "same-stage-create" };
  assert.equal((await f.request(path, create)).statusCode, 409);
  const reopened = await roadmap.recordOutcome(owner, goal.id, stage.id, { base_version: achieved.version,
    state: "reopened", note: "PRIVATE_REOPEN_REASON" });
  assert.equal((await f.request(path, { ...create, identity: other })).statusCode, 404);
  assert.equal((await f.request(path, { ...create, body: { goal_id: another.id, stage_id: stage.id } })).statusCode, 409);
  assert.equal((await f.request(path, { ...create, body: { goal_title: "篡改的目标", stage_id: stage.id } })).statusCode, 400);
  assert.equal((await f.request(path, { ...create, body: { goal_id: goal.id } })).statusCode, 201);
  const fresh = await f.request(path, { ...create, key: "verified-stage-create" });
  assert.equal(fresh.statusCode, 201, JSON.stringify(fresh.body));
  assert.deepEqual((await f.request(path, { ...create, key: "verified-stage-create" })).body.data, fresh.body.data);
  const session = (fresh.body.data as any).session;
  const ajv = new Ajv2020({ strict: false });
  addFormats(ajv);
  assert.equal(ajv.compile(contracts.LightTickPlanningCreateRequestSchema)(create.body), true);
  assert.equal(ajv.compile(contracts.LightTickPlanningMutationEnvelopeSchema)(fresh.body), true);
  assert.equal(session.stage_id, stage.id);
  assert.deepEqual(session.context.period_start, { value: "2026-11-25", source: "imported" });
  assert.deepEqual(session.context.period_end, { value: "2026-11-27", source: "imported" });
  const filters = { goal_id: goal.id, stage_id: stage.id, limit: "1" };
  const history = await f.request(path, { query: filters });
  assert.equal(ajv.compile(contracts.LightTickPlanningSessionListEnvelopeSchema)(history.body), true);
  assert.deepEqual((history.body.data as any).items.map((item: any) => [item.id, item.stage_id]), [[session.id, stage.id]]);
  assert.deepEqual((await f.request(path, { query: filters, identity: other })).body.data, { items: [] });
  assert.equal((await f.request(path, { query: { stage_id: stage.id } })).statusCode, 400);
  const selected = path + "/" + session.id;
  assert.equal((await f.request(selected + "/context", { method: "PATCH", body: {
    base_version: session.version, fields: { period_end: { value: "2026-11-28", source: "confirmed" } },
  } })).body.code, "LIGHTTICK_ROADMAP_STAGE_WINDOW");

  runtime.worker = new LightTickWorker(new LightTickAiRunner(repo, { complete: async (request: any) => {
    const content = request.messages[1].content;
    assert.ok(content.includes(stage.title));
    assert.ok(content.includes(stage.outcome_criteria));
    assert.ok(!content.includes("PRIVATE_ACHIEVEMENT") && !content.includes("PRIVATE_REOPEN_REASON"));
    return { provider: "synthetic", providerModel: "synthetic", text: JSON.stringify({ tasks: [
      { title: "录下三十秒进展汇报", estimated_minutes: 10, scheduled_for: "2026-11-25", completion_criteria: "开头一句是结论" },
    ] }) };
  } } as never, f.clock));
  const queued = await f.request(selected + "/drafts", { method: "POST", body: {
    base_version: session.version, context_revision: session.context_revision, deep_planning: true,
  } });
  assert.equal(queued.statusCode, 202, JSON.stringify(queued.body));
  await f.app.queue.processDueJobs(job => runtime.worker!.process(job), new Date("2030-01-01"));
  const preview = (await f.request(selected)).body.data as any;
  assert.equal(preview.status, "draft_ready", JSON.stringify(preview));
  const draft = await repo.getPlan(owner, preview.draft_plan_id);
  assert.equal(draft?.proposal.stage_id, stage.id);
  assert.deepEqual(await repo.listTasks(owner), []);
  const confirm = { method: "POST", key: "verified-stage-confirm", body: {
    base_version: preview.version, context_revision: preview.context_revision, draft_plan_id: draft!.id, plan_version: draft!.version,
  } };
  const saved = await f.request(selected + "/confirm", confirm);
  assert.equal(saved.statusCode, 200, JSON.stringify(saved.body));
  assert.deepEqual((await f.request(selected + "/confirm", confirm)).body.data, saved.body.data);
  assert.equal((await repo.getPlan(owner, draft!.id))?.proposal.stage_id, stage.id);
  const [task] = await repo.listTasks(owner, draft!.id);
  assert.deepEqual((await runtime.today.get(owner)).executableTasks.map(item => item.id), [task!.id]);
  assert.equal((await roadmap.get(owner, goal.id)).version, reopened.version);
  assert.equal((await roadmap.get(owner, goal.id)).stages[0]?.outcome?.state, "reopened");
});

test("closing a stage prevents both an in-flight preview and confirmation of an earlier preview", async () => {
  const f = await fixture();
  const { runtime } = f, repo = runtime.repository;
  const roadmap = new GoalRoadmapService(repo, f.clock);
  const goal = await runtime.goals.create(owner, { title: "可修订的汇报练习", constraints: { weekly_available_minutes: 30 } });
  const roadmapSaved = await roadmap.update(owner, goal.id, { base_version: 0, stages: [stage] });
  const create = async () => {
    const response = await f.request("planning-sessions", { method: "POST", body: { goal_id: goal.id, stage_id: stage.id } });
    assert.equal(response.statusCode, 201, JSON.stringify(response.body));
    return (response.body.data as any).session;
  };
  const queue = async (session: { id: string; version: number; context_revision: number }) => {
    const response = await f.request("planning-sessions/" + session.id + "/drafts", { method: "POST", body: {
      base_version: session.version, context_revision: session.context_revision, deep_planning: true,
    } });
    assert.equal(response.statusCode, 202, JSON.stringify(response.body));
    return (response.body.data as any).run.id;
  };
  let providerCalls = 0;
  runtime.worker = new LightTickWorker(new LightTickAiRunner(repo, { complete: async () => {
    providerCalls++;
    return { provider: "synthetic", providerModel: "synthetic", text: JSON.stringify({ tasks: [
      { title: "写下可以核对的汇报结论", estimated_minutes: 9, scheduled_for: "2026-11-26", completion_criteria: "一条结论和一个事实" },
    ] }) };
  } } as never, f.clock));
  const first = await create();
  await queue(first);
  await f.app.queue.processDueJobs(job => runtime.worker!.process(job), new Date("2030-01-01"));
  const ready = (await f.request("planning-sessions/" + first.id)).body.data as any;
  assert.equal(ready.status, "draft_ready", JSON.stringify(ready));
  const draft = await repo.getPlan(owner, ready.draft_plan_id);
  const second = await create();
  const pendingRun = await queue(second);
  await roadmap.recordOutcome(owner, goal.id, stage.id, { base_version: roadmapSaved.version,
    state: "achieved", note: "已经在真实周会上观察到达成情形" });
  const staleConfirm = await f.request("planning-sessions/" + first.id + "/confirm", { method: "POST", body: {
    base_version: ready.version, context_revision: ready.context_revision, draft_plan_id: draft!.id, plan_version: draft!.version,
  } });
  assert.equal(staleConfirm.body.code, "LIGHTTICK_VERSION_CONFLICT");
  await f.app.queue.processDueJobs(job => runtime.worker!.process(job), new Date("2030-01-01"));
  assert.equal(providerCalls, 1);
  assert.equal((await repo.getAiRun(owner, pendingRun))?.errorCode, "LIGHTTICK_PLANNING_STALE");
  assert.deepEqual(await repo.listTasks(owner), []);
  assert.deepEqual((await repo.listPlans(owner)).map(plan => plan.status), ["proposed"]);
});
