import assert from "node:assert/strict";
import test, { after } from "node:test";
import { randomUUID } from "node:crypto";
import { Pool } from "pg";
import { PostgresLightTickRepository } from "../../src/infrastructure/database/postgres/postgres-lighttick-repository.ts";
import { runPostgresMigrations } from "../../src/infrastructure/database/postgres/migrate.ts";
import { InMemoryJobQueue } from "../../src/infrastructure/queue/bullmq/in-memory-queue.ts";
import { LightTickAiRunner } from "../../src/modules/lighttick/ai/lighttick-ai-runner.ts";
import { LIGHTTICK_AI_SCENES } from "../../src/modules/lighttick/ai/lighttick-ai-scenes.ts";
import { LightTickGoalService } from "../../src/modules/lighttick/lighttick-goal.service.ts";
import { LearningRouteService } from "../../src/modules/lighttick/learning/learning-route.service.ts";
import { LearningWorkRunner } from "../../src/modules/lighttick/learning/learning-work.runner.ts";
import { LearningWorkService } from "../../src/modules/lighttick/learning/learning-work.service.ts";
import { NativeLearningService } from "../../src/modules/lighttick/learning/native-learning.service.ts";
import { LocalGenerationService } from "../../src/modules/lighttick/personal-model/local-generation.service.ts";
import { LightTickPlanningService } from "../../src/modules/lighttick/planning/planning.service.ts";
import { routeFixture } from "../support/learning-route-fixture.ts";
import { compliantLessonDraft } from "../support/lesson-draft-fixture.ts";

const dsn = process.env.LIGHTTICK_TEST_DATABASE_URL;
if (!dsn || !["127.0.0.1", "localhost"].includes(new URL(dsn).hostname) || !new URL(dsn).pathname.startsWith("/grow_web_u1_")) {
  throw new Error("Disposable localhost LightTick database required");
}
await runPostgresMigrations({ connectionString: dsn, log: () => {} });
const pool = new Pool({ connectionString: dsn, max: 8 });
after(() => pool.end());

const command = (generation: { revision: number; digest: string }, output: unknown) =>
  ({ base_revision: generation.revision, digest: generation.digest, output: JSON.stringify(output), finish_reason: "stop" });
const invalid = { code: "LIGHTTICK_SCENE_OUTPUT_INVALID", statusCode: 422 };
const notFound = { code: "LIGHTTICK_RESOURCE_NOT_FOUND", statusCode: 404 };
const output = { tasks: [{ title: "Collect the notes", estimated_minutes: 15, scheduled_for: "2026-11-22", completion_criteria: "List two observations" }] };

async function fixture() {
  const repository = new PostgresLightTickRepository(pool);
  const owner = { appId: "lighttick" as const, userId: "local-browser-" + randomUUID() };
  const other = { ...owner, userId: "other-browser-" + randomUUID() };
  let now = new Date("2026-11-22T03:00:00Z"), modelCalls = 0, allowed = true, upgrade = false;
  const clock = () => now;
  const queue = new InMemoryJobQueue();
  const native = new NativeLearningService(repository, true, clock);
  const routes = new LearningRouteService(native);
  const work = new LearningWorkService(routes, queue, () => true);
  const authorize = async () => { if (!allowed) throw new Error("owner revoked"); };
  const newService = (repo = repository) => new LocalGenerationService({
    repository: repo,
    scopePolicy: { assertFull: async () => {} },
    planningEnabled: true,
    learningWork: work,
    resolveAiScene: async scene => ({ ...LIGHTTICK_AI_SCENES[scene], ...(upgrade ? { maxOutputTokens: 830 } : {}) }),
  }, authorize, clock);
  const authority = await native.authority(owner);
  await native.consent(owner, { base_revision: authority!.revision, reading_enabled: true, private_enabled: true }, randomUUID());
  const goal = await new LightTickGoalService(repository, clock).create(owner,
    { title: "Evidence-based planning", constraints: { weekly_available_minutes: 60 } });
  const regular = { scene: "week_plan", input: { goal_id: goal.id, granularity: "week",
    period_start: "2026-11-22", period_end: "2026-11-28", available_minutes: 60 } };
  const routeId = "plan-browser-" + randomUUID().slice(0, 8);
  const outline = { scene: "learning_route", input: { route_id: routeId, base_revision: 0, brief: routeFixture().brief } };
  const caller = { complete: async () => { modelCalls++; throw new Error("Browser work must never use the server model"); } };
  const learningWorker = new LearningWorkRunner(work, caller, { readFile: async () => "", fetchUrl: async () => "" });
  const aiWorker = new LightTickAiRunner(repository, caller, clock);
  return { repository, owner, other, native, routes, routeId, work, clock, regular, outline, goal, newService, learningWorker, aiWorker,
    called: () => modelCalls, revoke: () => { allowed = false; }, changeRules: () => { upgrade = true; },
    expire: () => { now = new Date(now.getTime() + 601_000); }, advanceDay: () => { now = new Date(now.getTime() + 86_400_000); } };
}

test("an owned frozen plan is materialized once, can be reconciled after reconnect, and requires confirmation", async () => {
  const f = await fixture(), key = randomUUID(), requestKey = randomUUID();
  const service = f.newService();
  const generation = await service.prepare(f.owner, key, f.regular);
  assert.deepEqual(await service.prepare(f.owner, key, f.regular), generation);
  const row = await service.lookup(f.owner, key);
  await assert.rejects(service.status(f.other, generation.id), notFound);
  await assert.rejects(service.prepare(f.owner, key, { ...f.regular, input: { ...f.regular.input, available_minutes: 45 } }),
    { code: "LIGHTTICK_GENERATION_IDEMPOTENCY_MISMATCH" });
  const workerRun = await f.aiWorker.execute(f.owner, row.business_id, "week_plan");
  assert.equal(workerRun.status, "running");
  assert.match(generation.messages[1].content, /at most 60/);
  const [one, two] = await Promise.all([
    service.submit(f.owner, generation.id, requestKey, command(generation, output)),
    f.newService(new PostgresLightTickRepository(pool)).submit(f.owner, generation.id, requestKey, command(generation, output)),
  ]);
  assert.deepEqual(one, two);
  assert.equal(f.called(), 0);
  const plans = await f.repository.listPlans(f.owner);
  assert.equal(plans.length, 1);
  assert.equal(plans[0].status, "proposed");
  assert.deepEqual(await f.repository.listTasks(f.owner), []);
  f.changeRules();
  assert.deepEqual(await service.submit(f.owner, generation.id, requestKey, command(generation, output)), one);
  await assert.rejects(service.submit(f.owner, generation.id, requestKey, command(generation, { tasks: [] })),
    { code: "LIGHTTICK_GENERATION_IDEMPOTENCY_MISMATCH" });
  assert.equal((await f.repository.localGenerations.get(f.owner, generation.id))?.pending, undefined);
});

test("cancel, expiry, reading withdrawal, and invalid plan output stop materialization and queue recovery", async () => {
  const f = await fixture(), service = f.newService();
  const route = await service.prepare(f.owner, randomUUID(), f.outline);
  const routeReceipt = await service.status(f.owner, route.id);
  assert.equal(await f.learningWorker.recover(), 0);
  assert.equal(await f.learningWorker.execute(f.owner, routeReceipt.business_id), undefined);
  await assert.rejects(service.submit(f.owner, route.id, randomUUID(), command(route, {
    ...routeFixture().document, lessons: [routeFixture().document.lessons[0]],
  })), invalid);
  const cancelled = await service.prepare(f.owner, randomUUID(), f.regular);
  assert.equal((await service.cancel(f.owner, cancelled.id)).status, "cancelled");
  await assert.rejects(service.submit(f.owner, cancelled.id, randomUUID(), command(cancelled, output)), { code: "LIGHTTICK_GENERATION_CANCELLED" });
  const invalidPlan = await service.prepare(f.owner, randomUUID(), f.regular);
  await assert.rejects(service.submit(f.owner, invalidPlan.id, randomUUID(), command(invalidPlan, {
    tasks: [{ ...output.tasks[0], estimated_minutes: 61 }],
  })), invalid);
  const revoked = await service.prepare(f.owner, randomUUID(), f.outline);
  let authority = await f.native.authority(f.owner);
  await f.native.consent(f.owner, { base_revision: authority!.revision, reading_enabled: false, private_enabled: false }, randomUUID());
  authority = await f.native.authority(f.owner);
  await f.native.consent(f.owner, { base_revision: authority!.revision, reading_enabled: true, private_enabled: true }, randomUUID());
  await assert.rejects(service.submit(f.owner, revoked.id, randomUUID(), command(revoked, routeFixture().document)),
    { code: "LIGHTTICK_GENERATION_CONTEXT_CHANGED" });
  const timed = await service.prepare(f.owner, randomUUID(), f.regular);
  f.expire();
  await assert.rejects(service.submit(f.owner, timed.id, randomUUID(), command(timed, output)), { code: "LIGHTTICK_GENERATION_EXPIRED" });
  assert.equal((await service.status(f.owner, timed.id)).status, "expired");
  assert.equal(f.called(), 0);
  assert.equal(await f.repository.learningRoutes.getLearningRoute(f.owner, f.routeId), undefined);
  assert.deepEqual(await f.repository.listPlans(f.owner), []);
});

test("a changed rule prevents late output, expires a session cleanly, and prompts explicit new preparation", async () => {
  const f = await fixture(), service = f.newService();
  const planning = new LightTickPlanningService(f.repository, f.clock);
  const created = await planning.command(f.owner, randomUUID(), "create", undefined, { goal_id: f.goal.id });
  const ready = await planning.command(f.owner, randomUUID(), "context", created.session.id, {
    base_version: created.session.version, fields: {
      period_start: { value: "2026-11-22", source: "confirmed" },
      period_end: { value: "2026-11-28", source: "confirmed" },
    },
  });
  const prepare = (version: number) => service.prepare(f.owner, randomUUID(), { scene: "week_plan", planning_session_id: ready.session.id,
    input: { base_version: version, context_revision: ready.session.contextRevision, deep_planning: true } });
  const first = await prepare(ready.session.version);
  f.changeRules();
  await assert.rejects(service.submit(f.owner, first.id, randomUUID(), command(first, output)),
    { code: "LIGHTTICK_GENERATION_VERSION_MISMATCH" });
  const session = await planning.get(f.owner, ready.session.id);
  assert.equal(session.activeRunId, undefined);
  const second = await prepare(session.version);
  assert.notEqual(first.rules_digest, second.rules_digest);
  assert.equal((await service.submit(f.owner, second.id, randomUUID(), command(second, output))).status, "succeeded");
  assert.ok((await planning.get(f.owner, ready.session.id)).draftPlanId);
  assert.deepEqual(await f.repository.listTasks(f.owner), []);
});

test("browser packages share plan prompts and reject stale goal inputs before replay", async () => {
  const f = await fixture(), service = f.newService();
  const key = randomUUID();
  const generation = await service.prepare(f.owner, key, f.regular);
  const selection = { mode: "personal", revision: 27 };
  const { prepareAiGeneration } = await import("../../src/modules/lighttick/ai/lighttick-ai-generation.ts");
  const backend = await prepareAiGeneration(f.repository, f.owner, "week_plan",
    { ...f.regular.input, model_selection: selection }, LIGHTTICK_AI_SCENES.week_plan, f.clock);
  assert.deepEqual(generation.messages, backend.request.messages);
  assert.deepEqual(generation.output_schema, backend.schema);
  assert.equal(generation.model_requirements.max_output_tokens, backend.request.maxTokens);
  await new LightTickGoalService(f.repository, f.clock).update(f.owner, f.goal.id, f.goal.version, { title: "New goal context" });
  await assert.rejects(service.prepare(f.owner, key, f.regular), { code: "LIGHTTICK_GENERATION_CONTEXT_CHANGED" });
  await assert.rejects(service.submit(f.owner, generation.id, randomUUID(), command(generation, output)),
    { code: "LIGHTTICK_GENERATION_CONTEXT_CHANGED" });
  assert.deepEqual(await f.repository.listPlans(f.owner), []);
});

test("course browser validation enforces teaching sections, reviewed sources and published blueprints", async () => {
  const f = await fixture(), service = f.newService();
  const draft = routeFixture();
  const savedRoute = await f.routes.save(f.owner, f.routeId, { ...draft, base_revision: 0 }, randomUUID());
  const publication = await f.routes.publish(f.owner, f.routeId, { base_revision: savedRoute.revision }, randomUUID());
  const base = publication.revision;
  const lesson = { scene: "learning_lesson", input: { route_id: f.routeId, base_revision: base, number: 1,
    sources: [{ kind: "text", title: "Reviewed", text: "Reviewed facts." }],
  } };
  // A 路线后新课节必须带 design 且十段齐全；正文与 design 由同一蓝图推出，工作量才落在预算内。
  const blueprint = { number: 1, topic: "First", minutes: 15, kind: "lesson" as const };
  const sectionDraft = compliantLessonDraft(blueprint, "仅使用已核对资料");
  const sectionText = sectionDraft.content;
  const unreviewedLink = await service.prepare(f.owner, randomUUID(), lesson);
  await assert.rejects(service.submit(f.owner, unreviewedLink.id, randomUUID(), command(unreviewedLink, { content: sectionText,
    references: "https://invalid.example/unreviewed", design: sectionDraft.design })), invalid);
  const missingSection = await service.prepare(f.owner, randomUUID(), lesson);
  await assert.rejects(service.submit(f.owner, missingSection.id, randomUUID(), command(missingSection, { content: "几句正文",
    references: "仅使用已核对资料" })), invalid);
  const allowed = await service.prepare(f.owner, randomUUID(), lesson);
  const receipt = await service.submit(f.owner, allowed.id, randomUUID(), command(allowed, {
    content: sectionText, references: "仅使用已核对资料", design: sectionDraft.design,
  }));
  assert.equal((await f.repository.learningRoutes.listRouteLessonLinks(f.owner, f.routeId)).length, 0);
  const work = await f.work.read(f.owner, receipt.business_id);
  const adopted = await f.work.adopt(f.owner, work.id, { base_revision: work.revision, base_route_revision: base,
    expected_digest: work.output_digest }, randomUUID());
  const revised = await service.prepare(f.owner, randomUUID(), { scene: "learning_route",
    input: { route_id: f.routeId, base_revision: adopted.result.route_revision, brief: draft.brief } });
  const changed = structuredClone(draft.document);
  changed.lessons[0].topic = "Replace a published lesson";
  await assert.rejects(service.submit(f.owner, revised.id, randomUUID(), command(revised, changed)), invalid);
  assert.equal((await f.repository.learningRoutes.listRouteLessonLinks(f.owner, f.routeId)).length, 1);
});

test("same raw provider output has the same domain outcome via browser submission and server runners", async t => {
  const f = await fixture(), service = f.newService();
  const course = routeFixture();
  const active = await f.routes.save(f.owner, f.routeId, { ...course, base_revision: 0 }, randomUUID());
  const publication = await f.routes.publish(f.owner, f.routeId, { base_revision: active.revision }, randomUUID());
  const sourceUrl = "https://evidence.example/report";
  const learningLesson = { scene: "learning_lesson", input: {
    route_id: f.routeId, base_revision: publication.revision, number: 1,
    sources: [{ kind: "text", title: "Verified report", text: "Six approved; two pending. " + sourceUrl }],
  } };
  const lessonDraft = compliantLessonDraft({ number: 1, topic: "First", minutes: 15, kind: "lesson" }, sourceUrl);
  const text = lessonDraft.content;
  const properLesson = { content: text, references: sourceUrl, design: lessonDraft.design };
  const eightSections = ["引导问题", "概念", "示范", "边界", "练习", "参考分析", "自查", "记忆提示"]
    .map(section => (section === "参考分析" ? "---\n" : "") + "## " + section + "\n内容").join("\n");
  const { design: _design, ...noDesign } = properLesson;
  const outlineWith = (change: (draft: ReturnType<typeof routeFixture>["document"]) => void) => {
    const draft = structuredClone(course.document);
    change(draft);
    return draft;
  };

  const newOutline = { ...f.outline, input: { ...f.outline.input, route_id: f.routeId + "-new" } };
  type Intent = Parameters<LocalGenerationService["prepare"]>[2];
  async function pair(intent: Intent, value: unknown, valid: boolean) {
    if (String(intent.scene).startsWith("learning_")) f.advanceDay();
    const raw = JSON.stringify(value);
    const generation = await service.prepare(f.owner, randomUUID(), intent);
    const browserId = (await service.status(f.owner, generation.id)).business_id;
    const submit = () => service.submit(f.owner, generation.id, randomUUID(), command(generation, value));
    const requests: import("../../src/services/llm-manager-types.ts").LLMCompletionRequest[] = [];
    const provider = { complete: async (request: import("../../src/services/llm-manager-types.ts").LLMCompletionRequest) => {
      requests.push(request);
      return { text: raw, provider: "personal", modelKey: "parity-model", providerModel: "parity-model", finishReason: "stop" };
    } };
    if (String(intent.scene).startsWith("learning_")) {
      const kind = intent.scene === "learning_route" ? "route_draft" : "lesson_draft";
      const work = await f.work.create(f.owner, { kind, ...(intent.input as object) }, randomUUID());
      const runner = new LearningWorkRunner(f.work, provider, { readFile: async () => "", fetchUrl: async () => "" });
      await runner.execute(f.owner, work.id);
      const server = await f.work.read(f.owner, work.id);
      if (valid) await submit();
      else await assert.rejects(submit(), invalid);
      const browser = await f.work.read(f.owner, browserId);
      assert.equal(browser.status, server.status);
      assert.equal(browser.status, valid ? "succeeded" : "failed");
      if (!valid) assert.equal(server.error_code, "LEARNING_OUTPUT_INVALID");
      const domain = (value: Record<string, unknown> | null) => {
        if (value === null) return null;
        const { provider: _provider, model: _model, ...domain } = value;
        return domain;
      };
      assert.deepEqual(domain(browser.output), domain(server.output));
      assert.equal(browser.adopted, null);
      assert.equal(server.adopted, null);
    } else {
      const input = intent.input as Record<string, unknown>;
      const now = f.clock().toISOString();
      // Select the personal path so platform fallback cannot obscure an invalid response.
      const scene = LIGHTTICK_AI_SCENES.week_plan;
      const selected = await f.repository.saveAiRun({ ...f.owner, id: "lighttick_run_" + randomUUID(), kind: "plan",
        status: "queued", resourceId: f.goal.id, sceneKey: scene.key, promptVersion: scene.promptVersion,
        schemaVersion: scene.schemaVersion, attemptCount: 0, inputContext: { ...input, model_selection: { mode: "personal", revision: 1 } },
        usage: {}, createdAt: now, updatedAt: now });
      const server = await new LightTickAiRunner(f.repository, provider, f.clock).execute(f.owner, selected.id, "week_plan");
      if (valid) await submit();
      else await assert.rejects(submit(), invalid);
      const browser = (await f.repository.getAiRun(f.owner, browserId))!;
      assert.equal(browser.status, server.status);
      assert.equal(browser.status, valid ? "succeeded" : "failed");
      if (!valid) assert.equal(server.errorCode, "LIGHTTICK_PLAN_CONSTRAINT_FAILED");
      assert.deepEqual(browser.output, server.output);
      if (valid) {
        const browserPlan = (await f.repository.getPlan(f.owner, browser.resourceId!))!;
        const serverPlan = (await f.repository.getPlan(f.owner, server.resourceId!))!;
        assert.equal(browserPlan.status, "proposed");
        assert.equal(serverPlan.status, "proposed");
        assert.deepEqual(browserPlan.proposal.tasks, serverPlan.proposal.tasks);
      }
    }
    assert.equal(requests.length, 1);
    assert.deepEqual(requests[0].messages, generation.messages);
    assert.equal(requests[0].maxTokens, generation.model_requirements.max_output_tokens);
    assert.equal(requests[0].temperature, generation.model_requirements.temperature);
    assert.deepEqual(await f.repository.listTasks(f.owner), []);
  }

  await t.test("plan accepts valid output", () => pair(f.regular, output, true));
  await t.test("plan rejects excess budget", () => pair(f.regular, { tasks: [{ ...output.tasks[0], estimated_minutes: 61 }] }, false));
  await t.test("plan rejects out-of-window date", () => pair(f.regular, { tasks: [{ ...output.tasks[0], scheduled_for: "2026-12-03" }] }, false));
  await t.test("outline accepts complete output", () => pair(newOutline, course.document, true));
  await t.test("outline rejects the wrong count", () => pair(newOutline, outlineWith(doc => doc.lessons.pop()), false));
  await t.test("outline rejects a forward prerequisite", () => pair(newOutline, outlineWith(doc => { doc.lessons[0].requires = [2]; }), false));
  await t.test("lesson accepts ten sections, a design block and a reviewed source", () => pair(learningLesson, properLesson, true));
  await t.test("lesson rejects eight sections now that design is mandatory", () => pair(learningLesson, { ...properLesson, content: eightSections }, false));
  await t.test("lesson rejects a draft with no design block", () => pair(learningLesson, noDesign, false));
  await t.test("lesson rejects a missing section", () => pair(learningLesson, { ...properLesson, content: text.replace("记忆提示", "附录") }, false));
  await t.test("lesson rejects an unreviewed source", () => pair(learningLesson, { ...properLesson, references: "https://unreviewed.example/source" }, false));
  assert.equal((await f.repository.learningRoutes.listRouteLessonLinks(f.owner, f.routeId)).length, 0);

  const published = await f.routes.publishLesson(f.owner, f.routeId, 1, {
    base_revision: publication.revision, base_lesson_revision: 0, lesson_id: "lesson-" + randomUUID(), content: text,
  }, randomUUID());
  const frozen = { ...f.outline, input: { ...f.outline.input, base_revision: published.route_revision } };
  await t.test("outline preserves a frozen published lesson", () => pair(frozen, course.document, true));
  await t.test("outline rejects changes to a frozen published lesson", () =>
    pair(frozen, outlineWith(doc => { doc.lessons[0].assessment = "Replaced"; }), false));
  assert.equal((await f.repository.learningRoutes.listRouteLessonLinks(f.owner, f.routeId)).length, 1);
});
