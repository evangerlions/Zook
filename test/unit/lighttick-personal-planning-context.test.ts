import assert from "node:assert/strict";
import test from "node:test";
import Ajv2020 from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import { buildDefaultSeed } from "../../src/infrastructure/database/prisma/default-seed.ts";
import { LightTickPlanningContextRequestSchema, LightTickPlanningSessionSchema, LightTickPlanningFrameworkSchema } from "../../src/generated/openapi/public-contracts.generated.ts";
import { LIGHTTICK_AI_SCENES } from "../../src/modules/lighttick/ai/lighttick-ai-scenes.ts";
import { LightTickTodayService } from "../../src/modules/lighttick/lighttick-today.service.ts";
import { preparePlanningGeneration, validatePlanningGeneration } from "../../src/modules/lighttick/planning/planning-ai-generation.ts";
import { LightTickPlanningAiRunner } from "../../src/modules/lighttick/planning/planning-ai-runner.ts";
import { LightTickPlanningService } from "../../src/modules/lighttick/planning/planning.service.ts";
import { createApplication } from "../support/create-test-application.ts";

const owner = { appId: "lighttick", userId: "user_alice" } as const;
const other = { appId: "lighttick", userId: "user_bob" } as const;
const fixed = new Date("2026-11-25T12:00:00Z");
const clock = () => fixed;
const start = "2026-11-25";
const end = "2026-11-28";
const yes = <T>(value: T) => ({ value, source: "confirmed" });

async function setup() {
  const seed = buildDefaultSeed(undefined, { includeLightTick: true });
  for (const identity of [owner, other]) seed.appUsers.push({
    ...identity, id: "personal-planning-" + identity.userId,
    status: "ACTIVE", accountRegion: "UNKNOWN", joinedAt: fixed.toISOString(),
  });
  const app = await createApplication({ seed, lighttickEnabled: true });
  const runtime = app.services.lighttickRuntime!;
  runtime.planningEnabled = true;
  runtime.today = new LightTickTodayService(runtime.repository, clock);
  const service = new LightTickPlanningService(runtime.repository, clock);
  async function call(path: string, method = "GET", body?: unknown, key?: string, account: typeof owner | typeof other = owner) {
    const response = await app.app.handle({ path: "/api/v1/lighttick/" + path, method, body, headers: {
      authorization: "Bearer " + app.services.tokenService.issueAccessToken(account.userId, "lighttick"),
      ...(key ? { "idempotency-key": key } : {}),
    } });
    return { ...response, data: response.body.data as any };
  }
  return { runtime, service, call };
}

test("saved original plan is reviewed line by line and warns only about comparable owned goal actions", async () => {
  const { runtime, call } = await setup();
  const goal = await runtime.goals.create(owner, { title: "准备技能认证考试", targetDate: "2026-12-15", constraints: {} });
  const otherGoal = await runtime.goals.create(other, { title: goal.title, constraints: {} });
  const added = [];
  for (const [identity, target] of [[owner, goal], [other, otherGoal]] as const) {
    const proposal = await runtime.plans.createProposed(identity, {
      goalId: target.id, granularity: "week", source: "ai", periodStart: start, periodEnd: end,
      tasks: [{ title: "复述资料", scheduledFor: start, estimatedMinutes: 15 }],
    });
    added.push((await runtime.plans.confirm(identity, proposal.id, proposal.version)).tasks[0]!);
  }
  const created = await call("planning-sessions", "POST", { goal_id: goal.id }, "personal-review-create");
  assert.equal(created.statusCode, 201);
  const sessionId = created.data.session.id;
  assert.equal(created.data.session.mode_recommendation.mode, "deadline");
  assert.equal(created.data.session.context.mode, undefined);
  assert.ok(created.data.session.unknown_fields.includes("materials"));
  const source = " 1. 2026-11-25 复述资料（15 分钟）\n\n2026-11-26 复述资料 10分钟\n明天整理例子 10 - 20 分钟\n2026-02-30 整理材料";
  const write = { base_version: created.data.session.version, fields: {
    existing_plan: yes(source), materials: yes("本人笔记"), mode: yes("skill"), secondary_mode: yes("project"),
  } };
  const path = "planning-sessions/" + sessionId;
  const saved = await call(path + "/context", "PATCH", write, "personal-review-save");
  assert.equal(saved.statusCode, 200);
  const session = saved.data.session;
  const ajv = new Ajv2020({ strict: false });
  addFormats(ajv);
  assert.ok(ajv.validate(LightTickPlanningContextRequestSchema, write), JSON.stringify(ajv.errors));
  assert.ok(ajv.validate(LightTickPlanningSessionSchema, session), JSON.stringify(ajv.errors));
  assert.deepEqual(session.context.existing_plan, { value: source, source: "imported" });
  assert.deepEqual(session.context.materials, { value: "本人笔记", source: "confirmed" });
  assert.equal(session.context.mode.value, "skill");
  assert.equal(session.mode_recommendation.mode, "deadline");
  assert.ok(!session.unknown_fields.includes("materials"));
  assert.deepEqual(session.existing_plan_review.lines, [
    { line_number: 1, text: " 1. 2026-11-25 复述资料（15 分钟）", source_date: start, estimated_minutes: 15,
      likely_duplicates: [{ task_id: added[0]!.id, title: "复述资料", scheduled_date: start }] },
    { line_number: 3, text: "2026-11-26 复述资料 10分钟", source_date: "2026-11-26", estimated_minutes: 10, likely_duplicates: [] },
    { line_number: 4, text: "明天整理例子 10 - 20 分钟", source_date: null, estimated_minutes: null, likely_duplicates: [] },
    { line_number: 5, text: "2026-02-30 整理材料", source_date: null, estimated_minutes: null, likely_duplicates: [] },
  ]);
  assert.deepEqual((await call(path)).data.existing_plan_review, session.existing_plan_review);
  assert.equal((await call(path, "GET", undefined, undefined, other)).statusCode, 404);
  assert.deepEqual((await call(path + "/context", "PATCH", write, "personal-review-save")).data.session, session);
  assert.equal((await runtime.repository.listTasks(owner)).length, 1);
});

test("all supported choices are versioned, explicit clears stay unknown, and bad sources do not write", async () => {
  const { runtime, service } = await setup();
  const { session: initial } = await service.command(owner, "mode-validate-create", "create", undefined, { goal_title: "练习短汇报" });
  let current = initial;
  async function patch(key: string, fields: object) {
    return service.command(owner, key, "context", initial.id, { base_version: current.version, fields });
  }
  for (const mode of ["deadline", "skill", "project", "routine", "exploration"]) {
    current = (await patch("mode-change-" + mode, { mode: yes(mode) })).session;
    assert.equal(current.context.mode?.value, mode);
  }
  for (const [i, fields] of [
    { mode: yes("invented") }, { secondary_mode: yes("exploration") }, { invented_field: yes(null) },
    { existing_plan: { value: "绕过来源", source: "imported" } }, { existing_plan: yes("字".repeat(2501)) },
    { existing_plan: yes(Array(41).fill("短一行").join("\n")) }, { identity: yes("字".repeat(201)) },
  ].entries()) {
    await assert.rejects(() => patch("rejected-context-" + i, fields), { code: "REQ_FIELD_INVALID" });
  }
  current = (await patch("reviewed-source-and-mode", {
    secondary_mode: yes("skill"), materials: yes("先用自己写的讲稿"), identity: yes("我的身份说明"), existing_plan: yes("录一段练习"),
    available_minutes: yes(25), period_start: yes(start), period_end: yes(end),
  })).session;
  assert.equal(current.status, "ready");
  const started = await service.command(owner, "reviewed-old-run", "drafts", initial.id, {
    base_version: current.version, context_revision: current.contextRevision, deep_planning: true,
  });
  const runner = new LightTickPlanningAiRunner(runtime.repository, {
    complete: async () => ({ text: JSON.stringify({ tasks: [{ title: "留下三句话", estimated_minutes: 10 }] }), provider: "fake" }),
  }, clock);
  assert.equal((await runner.execute(owner, started.run!.id)).status, "succeeded");
  current = await service.get(owner, initial.id);
  const oldDraftId = current.draftPlanId;
  const oldRevision = current.contextRevision;
  current = (await patch("clear-reviewed-facts", {
    mode: yes(null), materials: yes(null), identity: yes(null), existing_plan: yes(null), objective: yes(null),
  })).session;
  assert.equal(current.contextRevision, oldRevision + 1);
  assert.equal(current.status, "collecting");
  assert.equal(current.context.mode, undefined);
  assert.equal(current.context.secondary_mode, undefined);
  assert.equal(current.context.existing_plan, undefined);
  assert.equal(current.existingPlanReview, undefined);
  assert.equal(current.draftPlanId, undefined);
  assert.equal((await runtime.repository.getPlan(owner, oldDraftId!))?.status, "proposed");
  await assert.rejects(() => service.command(owner, "early-new-run", "drafts", initial.id, {
    base_version: current.version, context_revision: current.contextRevision, deep_planning: true,
  }), { code: "LIGHTTICK_PLANNING_NOT_READY" });
  assert.deepEqual(await runtime.repository.listTasks(owner), []);
});

test("the server enforces the question bound for structured and legacy replies", () => {
  const prepare = { clarify: true, context: {} };
  const check = (value: object) => validatePlanningGeneration(prepare, JSON.stringify(value));
  const accepted = check({ message: "请先核对这些条件。", fields: {}, questions: ["什么时候开始？", "想达到什么结果？", "每周有多少时间？"] });
  assert.deepEqual(accepted.questions, ["什么时候开始？", "想达到什么结果？", "每周有多少时间？"]);
  assert.match(accepted.message, /什么时候开始/);
  assert.deepEqual(check({ message: "你希望什么？你是否有材料？", fields: {} }).questions, ["你希望什么？", "你是否有材料？"]);
  for (const malformed of [
    { message: "核对条件。", fields: {}, questions: ["哪天", "多久", "有什么", "做多少"] },
    { message: "什么时候？有多久？想做什么？需要谁？", fields: {} },
    { message: "什么时候？有多久？", fields: {}, questions: ["想做什么？", "需要谁？"] },
    { message: "1. 基础\n2. 结果\n3. 空闲时间\n4. 材料", fields: {} },
    { message: "核对条件。", fields: {}, questions: ["什么时候？有多久？"] },
    { message: "这是我找到的旧计划。", fields: { existing_plan: "不应从模型保存" } },
  ]) assert.throws(() => check(malformed));
});

test("model input bounds copied plans and only opted-in drafts store a validated dated framework", async () => {
  const { runtime, service } = await setup();
  const goal = await runtime.goals.create(owner, { title: "复述短文", targetDate: "2026-12-10", constraints: {} });
  const { session: initial } = await service.command(owner, "framework-create", "create", undefined, { goal_id: goal.id });
  const original = Array.from({ length: 20 }, (_, index) => (index + 1) + ". " + "练习".repeat(43)).join("\n");
  const { session: ready } = await service.command(owner, "framework-context", "context", initial.id, { base_version: initial.version,
    fields: { mode: yes("deadline"), secondary_mode: yes("skill"), existing_plan: yes(original), materials: yes("我已有一段短文"),
      period_start: yes(start), period_end: yes(end), available_minutes: yes(25) } });
  const { run } = await service.command(owner, "framework-draft", "drafts", ready.id, {
    base_version: ready.version, context_revision: ready.contextRevision, deep_planning: true, include_framework: true,
  });
  const generated = await preparePlanningGeneration(runtime.repository, owner, run!, LIGHTTICK_AI_SCENES.week_plan);
  const prompt = generated.request.messages[1]!.content;
  const modelInput = JSON.parse(prompt.split("\nINPUT_JSON=")[1]!);
  assert.equal(modelInput.context.materials.value, "我已有一段短文");
  assert.equal(modelInput.context.mode.value, "deadline");
  assert.equal(modelInput.context.secondary_mode.value, "skill");
  assert.equal(modelInput.existing_plan_excerpt, true);
  assert.equal(modelInput.target_date, goal.targetDate);
  assert.ok(Buffer.byteLength(modelInput.context.existing_plan.value) <= 1200);
  assert.ok(modelInput.context.existing_plan.value.split("\n").length <= 12);
  assert.equal(generated.context.existing_plan?.value, original);
  assert.equal(ready.existingPlanReview?.lines.length, 20);
  const tasks = [{ title: "完成近期开头", scheduled_for: start, estimated_minutes: 10 }];
  assert.throws(() => validatePlanningGeneration(generated, JSON.stringify({ tasks })));
  const suggestions = { tasks, framework: { rationale: "先练基线，再提高难度",
    stages: [{ title: "验证基线", outcome_criteria: "留下三句复述", starts_on: start, ends_on: "2026-12-01" },
      { title: "处理一个新材料", outcome_criteria: "可独立复述", starts_on: null, ends_on: null }] } };
  const runner = new LightTickPlanningAiRunner(runtime.repository, {
    complete: async () => ({ text: JSON.stringify(suggestions), provider: "fake" }),
  }, clock);
  assert.equal((await runner.execute(owner, run!.id)).status, "succeeded");
  const current = await service.get(owner, ready.id);
  const draft = await runtime.repository.getPlan(owner, current.draftPlanId!);
  assert.ok(draft);
  const framework = draft.proposal.framework as { available_minutes: number };
  assert.equal(framework.available_minutes, 25);
  const ajv = new Ajv2020({ strict: false });
  addFormats(ajv);
  assert.ok(ajv.validate(LightTickPlanningFrameworkSchema, framework), JSON.stringify(ajv.errors));
  assert.equal((draft.proposal.tasks as unknown[]).length, 1);
  assert.deepEqual(await runtime.repository.listTasks(owner), []);
  assert.equal(validatePlanningGeneration({ clarify: false, context: generated.context }, JSON.stringify(suggestions)).framework, undefined);
});

test("ended goals keep planning history and accepted receipts while refusing new writes or runs", async () => {
  const { runtime, service, call } = await setup();
  for (const action of ["complete", "archive"] as const) {
    const goal = await runtime.goals.create(owner, { title: "保留目标规划历史 " + action, constraints: {} });
    const createKey = "planning-before-end-" + action;
    const createBody = { goal_id: goal.id };
    const created = await service.command(owner, createKey, "create", undefined, createBody);
    const editKey = "context-before-end-" + action;
    const edit = { base_version: created.session.version, fields: {
      mode: yes("skill"), available_minutes: yes(30), period_start: yes(start), period_end: yes(end),
    } };
    const saved = await service.command(owner, editKey, "context", created.session.id, edit);
    if (action === "complete") {
      const proposal = await runtime.plans.createProposed(owner, { goalId: goal.id, granularity: "day", source: "ai",
        periodStart: start, periodEnd: start, tasks: [{ title: "已安排的练习", estimatedMinutes: 10, scheduledFor: start }] });
      await runtime.plans.confirm(owner, proposal.id, proposal.version);
    }
    const active = await runtime.goals.get(owner, goal.id);
    await runtime.goals.transition(owner, goal.id, active.version, action);
    const history = await call("planning-sessions/" + saved.session.id);
    assert.equal(history.statusCode, 200);
    assert.equal(history.data.can_generate, false);
    assert.equal(history.data.context.mode.value, "skill");
    assert.deepEqual(await service.command(owner, createKey, "create", undefined, createBody), created);
    assert.deepEqual(await service.command(owner, editKey, "context", saved.session.id, edit), saved);
    await assert.rejects(() => service.command(owner, "new-after-end-" + action, "create", undefined, createBody),
      { code: "LIGHTTICK_STATE_TRANSITION_INVALID" });
    for (const [operation, data] of [
      ["context", { fields: { mode: yes("routine") } }],
      ["messages", { message: "我想继续安排" }],
      ["drafts", { context_revision: saved.session.contextRevision, deep_planning: true, include_framework: true }],
    ] as const) {
      const key = "new-after-end-" + action + "-" + operation;
      await assert.rejects(() => service.command(owner, key, operation, saved.session.id, {
        ...data, base_version: saved.session.version,
      }), { code: "LIGHTTICK_STATE_TRANSITION_INVALID" });
      assert.equal(await runtime.repository.getOperation(owner, "planning:" + key), undefined);
    }
    assert.deepEqual(await service.get(owner, saved.session.id), saved.session);
  }
});
