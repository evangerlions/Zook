import assert from "node:assert/strict";
import test from "node:test";
import { Ajv2020 } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { LightTickTaskDetailEnvelopeSchema } from "../../src/generated/openapi/public-contracts.generated.ts";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { LightTickAiRunner } from "../../src/modules/lighttick/ai/lighttick-ai-runner.ts";
import { LightTickTaskService } from "../../src/modules/lighttick/lighttick-task.service.ts";
import { LightTickTodayService } from "../../src/modules/lighttick/lighttick-today.service.ts";
import { LightTickWorker } from "../../src/modules/lighttick/lighttick-worker.ts";
import { LocalGenerationService } from "../../src/modules/lighttick/personal-model/local-generation.service.ts";
import type { LLMCompletionRequest } from "../../src/services/llm-manager-types.ts";
import type { HttpRequest } from "../../src/shared/types.ts";
import { createApplication } from "../support/create-test-application.ts";

const owner = { appId: "lighttick", userId: "user_alice" } as const;
const now = new Date("2026-11-29T16:30:00Z");
const date = "2026-11-30";
const material = "本人提供的项目简报 https://example.test/my-brief";
const secondMaterial = "自查标准：只保留两条要点";
const reviewed = {
  title: "圈出简报里的两条要点", scheduled_for: date, estimated_minutes: 10,
  completion_criteria: "每条要点都有一句可复述的依据",
  steps: ["读项目简报 https://example.test/my-brief", "各用一句话复述两个要点"],
  guidance: { materials: [material], expected_output: "两条要点和各自的一句依据",
    preparation: { kind: "provided", instruction: "打开本人保存的项目简报" } },
};
const fallback = {
  title: "写一段能开口说的结论", scheduled_for: date, estimated_minutes: 7,
  completion_criteria: "写出一句结论和一个可理解的例子",
  steps: ["用自己的话表达结论", "举一个刚想出来的例子"],
  guidance: { materials: [], expected_output: "一句结论和一个例子",
    preparation: { kind: "self_contained", instruction: "任选一个熟悉主题，无需查找材料" } },
};
const framework = { rationale: "先敲定两条要点，再练一遍复述。",
  stages: [{ title: "复述要点", outcome_criteria: "能独立说清两条要点", starts_on: date, ends_on: "2026-12-06" }] };

async function fixture() {
  const seed = buildDefaultSeed(undefined, { includeLightTick: true });
  for (const userId of [owner.userId, "user_bob"]) seed.appUsers.push({
    id: "action-brief-" + userId, appId: owner.appId, userId, status: "ACTIVE", accountRegion: "UNKNOWN", joinedAt: now.toISOString(),
  });
  const delivery = seed.appConfigs.find(row => row.appId === owner.appId && row.configKey === "admin.delivery_config")!;
  const config = JSON.parse(delivery.configValue);
  delivery.configValue = JSON.stringify({ ...config, enabled: true, settings: { ...config.settings, runtimeScope: "full" },
    featureFlags: { ...config.featureFlags, aiPlanning: true, conversationalPlanning: true } });
  const { app, queue, services: { lighttickRuntime: runtime, tokenService } } = await createApplication({ seed, lighttickEnabled: true });
  const repository = runtime.repository;
  runtime.planningEnabled = true;
  runtime.today = new LightTickTodayService(repository, () => now);
  runtime.tasks = new LightTickTaskService(repository, () => now);
  let sequence = 0;
  async function call(path: string, method: HttpRequest["method"] = "GET", body?: HttpRequest["body"],
    { key, userId = owner.userId as string, query }: { key?: string; userId?: string; query?: HttpRequest["query"] } = {}) {
    const result = await app.handle({ path: "/api/v1/lighttick/" + path, method, body, query, headers: {
      authorization: "Bearer " + tokenService.issueAccessToken(userId, owner.appId), "x-app-id": owner.appId,
      "x-lighttick-task-schema": "2", "idempotency-key": key ?? "action-brief-proof-" + (++sequence),
    } });
    const { code, data } = result.body as { code: string; data: any };
    return { status: result.statusCode, code, data, envelope: result.body };
  }
  assert.equal((await call("profile", "PATCH", { base_version: 0, timezone: "Asia/Shanghai" })).status, 200);
  const goal = await call("goals", "POST", { title: "用自己的话讲清简报", constraints: { weekly_available_minutes: 40 } });
  assert.equal(goal.status, 201, JSON.stringify(goal));
  const started = await call("planning-sessions", "POST", { goal_id: goal.data.id });
  assert.equal(started.status, 201, JSON.stringify(started));
  const path = "planning-sessions/" + started.data.session.id;
  const current = async () => (await call(path)).data;
  async function context(source: "user" | "confirmed") {
    const session = await current();
    return call(path + "/context", "PATCH", { base_version: session.version, fields: {
      materials: { value: material + "\r\n\r\n  " + secondMaterial + "  ", source },
      period_start: { value: date, source: "confirmed" }, period_end: { value: "2026-12-06", source: "confirmed" },
    } });
  }
  async function generate(inspect: (request: LLMCompletionRequest) => unknown, flag: unknown = true) {
    const session = await current();
    const started = await call(path + "/drafts", "POST", { base_version: session.version, context_revision: session.context_revision,
      deep_planning: true, include_framework: true, ...(flag === false ? {} : { include_action_brief: flag }) });
    if (started.status !== 202) return { ...started, run: undefined };
    const runner = new LightTickAiRunner(repository, { complete: async request => ({
      provider: "stub", providerModel: "stub", modelKey: request.modelKey ?? "stub", text: JSON.stringify(await inspect(request)),
    }) }, () => now);
    runtime.worker = new LightTickWorker(runner);
    await queue.processDueJobs(job => runtime.worker!.process(job), new Date("2030-01-01"));
    const saved = await repository.getAiRun(owner, started.data.run.id);
    return { ...started, run: saved };
  }
  async function plannedInput() {
    const session = await current();
    const plan = await call("plans/" + session.draft_plan_id);
    assert.equal(plan.status, 200, JSON.stringify(plan));
    return { plan: plan.data, payload: { base_version: session.version, context_revision: session.context_revision,
      draft_plan_id: session.draft_plan_id, plan_version: plan.data.version } };
  }
  const preview = (plan: { id: string; version: number }, userId?: string) =>
    call("planning-capacity/preview", "GET", undefined, { query: { plan_id: plan.id, plan_version: String(plan.version) }, userId });
  return { call, context, current, generate, path, plannedInput, preview, repository, runtime, tasks: runtime.tasks };
}

function promptInput(request: LLMCompletionRequest) {
  const prompt = request.messages.at(-1)!.content!;
  return JSON.parse(prompt.slice(prompt.indexOf("INPUT_JSON=") + "INPUT_JSON=".length));
}

test("an opted-in AI brief uses only explicitly reviewed material and validates independently of the model", async () => {
  const { context, current, generate, repository } = await fixture();
  assert.equal((await context("user")).status, 200);
  const unreviewed = await generate(request => {
    const input = promptInput(request);
    assert.deepEqual(input.action_brief_materials, []);
    assert.ok(!("materials" in input.context));
    return { tasks: [reviewed], framework };
  });
  assert.equal(unreviewed.run?.status, "failed");
  assert.equal(unreviewed.run?.errorCode, "LIGHTTICK_PLAN_CONSTRAINT_FAILED");
  assert.equal((await repository.listPlans(owner)).length, 0);
  assert.equal((await context("confirmed")).status, 200);
  assert.equal((await generate(() => null, "true")).status, 400);
  for (const invalid of [
    { ...reviewed, guidance: { ...reviewed.guidance, materials: ["本人提供的项目简报"] } },
    { ...fallback, steps: ["打开未提供的 https://example.test/foreign-note"] },
    { ...fallback, guidance: { ...fallback.guidance, materials: [secondMaterial] } },
    { ...reviewed, completion_criteria: undefined },
    { ...reviewed, scheduled_for: undefined },
  ]) {
    const rejected = await generate(request => {
      assert.deepEqual(promptInput(request).action_brief_materials, [material, secondMaterial]);
      return { tasks: [invalid], framework };
    });
    assert.equal(rejected.run?.errorCode, "LIGHTTICK_PLAN_CONSTRAINT_FAILED");
    assert.equal((await current()).draft_plan_id, null);
    assert.equal((await repository.listTasks(owner)).length, 0);
  }
});

test("the marked draft, Today and a linked remaining action preserve reviewed preparation and exact confirmation receipt", async () => {
  const { call, context, generate, path, plannedInput, preview, repository, tasks } = await fixture();
  assert.equal((await context("confirmed")).status, 200);
  const ready = await generate(request => {
    assert.deepEqual(promptInput(request).action_brief_materials, [material, secondMaterial]);
    assert.match(request.messages.at(-1)!.content!, /action_brief_materials/);
    assert.equal(request.providerOptions?.zookLogBodyMode, "suppress");
    return { tasks: [reviewed, fallback], framework };
  });
  assert.equal(ready.run?.status, "succeeded", JSON.stringify(ready.run));
  const { plan, payload } = await plannedInput();
  assert.equal(plan.proposal.action_brief_required, true);
  assert.deepEqual(plan.proposal.tasks[0].guidance, reviewed.guidance);
  const capacity = await preview(plan);
  assert.equal(capacity.status, 200, JSON.stringify(capacity));
  assert.equal(capacity.data.plan_id, plan.id);
  assert.equal(capacity.data.plan_version, plan.version);
  assert.equal(capacity.data.weeks[0].proposed_minutes, 17);
  assert.equal((await preview(plan, "user_bob")).status, 404);
  assert.deepEqual((await call("today")).data.tasks, []);

  const forged = { ...reviewed, guidance: { ...reviewed.guidance, materials: ["Other account project notes"] } };
  const editRejected = await call(path + "/draft", "PATCH", { ...payload, tasks: [forged, fallback] });
  assert.equal(editRejected.status, 422);
  assert.equal(editRejected.code, "LIGHTTICK_PLAN_CONSTRAINT_FAILED");
  const adjusted = { ...reviewed, estimated_minutes: 12 };
  const editAccepted = await call(path + "/draft", "PATCH", { ...payload, tasks: [adjusted, fallback] });
  assert.equal(editAccepted.status, 200, JSON.stringify(editAccepted));
  const edited = await plannedInput();
  assert.equal((await preview(plan)).status, 409);
  assert.equal((await preview(edited.plan)).data.weeks[0].proposed_minutes, 19);
  const key = "reviewed-action-brief-confirm";
  const first = await call(path + "/confirm", "POST", edited.payload, { key });
  assert.equal(first.status, 200, JSON.stringify(first));
  assert.equal(first.data.session.status, "confirmed");
  const today = (await call("today")).data;
  const actual = today.tasks.find((task: { title: string }) => task.title === adjusted.title);
  assert.equal(actual.estimated_duration_minutes, 12);
  assert.deepEqual(actual.guidance, adjusted.guidance);
  assert.deepEqual(actual.steps.map((step: { title: string }) => step.title), adjusted.steps);
  assert.equal(actual.completion_criteria, adjusted.completion_criteria);
  assert.deepEqual(today.tasks.find((task: { title: string }) => task.title === fallback.title).guidance, fallback.guidance);

  const scope = "tasks/" + actual.id;
  const originalDetail = await call(scope);
  const ajv = addFormats(new Ajv2020({ strict: false }));
  assert.ok(ajv.validate(LightTickTaskDetailEnvelopeSchema, JSON.parse(JSON.stringify(originalDetail.envelope))), JSON.stringify(ajv.errors));
  assert.equal(originalDetail.data.version, actual.version);
  assert.equal(originalDetail.data.estimated_duration_minutes, 12);
  assert.deepEqual(originalDetail.data.guidance, adjusted.guidance);
  assert.equal(originalDetail.data.completion_criteria, adjusted.completion_criteria);
  assert.equal((await call(scope, "GET", undefined, { userId: "user_bob" })).status, 404);
  const checked = await tasks.setStepCompletion(owner, actual.id, actual.steps[0].id, actual.version, true);
  const partial = await call(scope + "/progress", "POST", { action: "record_partial", base_version: checked.task.version,
    outcome: "已圈出两条要点", remaining_work: "补一句依据", actual_minutes: 5, remaining_estimated_minutes: 7 });
  assert.equal(partial.status, 200, JSON.stringify(partial));
  const child = await call(scope + "/progress", "POST", { action: "split", base_version: partial.data.task.version,
    title: "给要点补上依据", scheduled_for: date, remaining_estimated_minutes: 7 });
  assert.equal(child.status, 200, JSON.stringify(child));
  const continuation = await call("tasks/" + child.data.remaining_task.id);
  assert.deepEqual(continuation.data.guidance, adjusted.guidance);
  assert.equal(continuation.data.completion_criteria, adjusted.completion_criteria);
  assert.deepEqual(continuation.data.steps.map((step: { title: string }) => step.title), adjusted.steps.slice(1));
  assert.equal((await call(scope)).data.execution_progress.outcome, "已圈出两条要点");
  assert.equal((await call(scope)).data.steps[0].completed, true);
  assert.deepEqual((await call(path + "/confirm", "POST", edited.payload, { key })).data, first.data);
  assert.equal((await repository.listTasks(owner)).length, 3);
});


test("browser generation is held to the same material scope, and confirmation checks the stored brief again", async () => {
  const { call, context, current, path, plannedInput, preview, repository, runtime } = await fixture();
  assert.equal((await context("confirmed")).status, 200);
  const local = new LocalGenerationService(runtime, async () => {}, () => now);
  async function prepare(key: string) {
    const session = await current();
    return local.prepare(owner, key, { scene: "week_plan", planning_session_id: session.id,
      input: { base_version: session.version, context_revision: session.context_revision, deep_planning: true, include_action_brief: true } });
  }
  const denied = await prepare("local-brief-action-first");
  const packageInput = denied.messages.at(-1)!.content.split("INPUT_JSON=")[1]!;
  assert.deepEqual(JSON.parse(packageInput).action_brief_materials, [material, secondMaterial]);
  const foreign = { ...reviewed, guidance: { ...reviewed.guidance, materials: ["Foreign brief"] } };
  await assert.rejects(local.submit(owner, denied.id, "local-brief-reject", { base_revision: denied.revision, digest: denied.digest,
    output: JSON.stringify({ tasks: [foreign] }), finish_reason: "stop" }), { code: "LIGHTTICK_SCENE_OUTPUT_INVALID" });
  assert.deepEqual(await repository.listPlans(owner), []);

  const allowed = await prepare("local-brief-action-second");
  await local.submit(owner, allowed.id, "local-brief-accept", {
    base_revision: allowed.revision, digest: allowed.digest, output: JSON.stringify({ tasks: [reviewed] }), finish_reason: "stop",
  });
  const { plan, payload } = await plannedInput();
  assert.equal(plan.proposal.action_brief_required, true);
  const row = (await repository.getPlan(owner, plan.id))!;
  const tampered = { ...plan.proposal.tasks[0], guidance: { ...reviewed.guidance, materials: ["Foreign brief"] } };
  const corrupted = await repository.savePlan({ ...row, proposal: { ...row.proposal, tasks: [tampered] } }, {
    event: { ...owner, id: "malformed-action-fixture-event", aggregateType: "plan", aggregateId: row.id,
      eventType: "fixture", aggregateVersion: row.version + 1, payload: {}, occurredAt: now.toISOString(), createdAt: now.toISOString() },
    change: { ...owner, entityType: "plan", entityId: row.id, entityVersion: row.version + 1, operation: "upsert",
      snapshot: {}, changedAt: now.toISOString() },
  }, row.version);
  const badPreview = await preview(corrupted);
  assert.equal(badPreview.status, 422);
  assert.equal(badPreview.code, "LIGHTTICK_PLAN_CONSTRAINT_FAILED");
  const tried = await call(path + "/confirm", "POST", { ...payload, plan_version: corrupted.version });
  assert.equal(tried.status, 422);
  assert.equal(tried.code, "LIGHTTICK_PLAN_CONSTRAINT_FAILED");
  assert.equal((await current()).status, "draft_ready");
  assert.deepEqual(await repository.listTasks(owner), []);
});


test("capacity review reuses the legacy rules for a draft without an action-brief marker", async () => {
  const { context, generate, plannedInput, preview } = await fixture();
  assert.equal((await context("confirmed")).status, 200);
  const legacy = await generate(() => ({
    tasks: [{ title: "Older dated action", estimated_minutes: 9, scheduled_for: date }], framework,
  }), false);
  assert.equal(legacy.status, 202, JSON.stringify(legacy));
  assert.equal(legacy.run?.status, "succeeded", JSON.stringify(legacy.run));
  const { plan } = await plannedInput();
  assert.equal(plan.proposal.action_brief_required, undefined);
  const result = await preview(plan);
  assert.equal(result.status, 200, JSON.stringify(result));
  assert.equal(result.data.weeks[0].proposed_minutes, 9);
});
