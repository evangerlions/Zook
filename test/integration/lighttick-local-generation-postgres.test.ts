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
    expire: () => { now = new Date(now.getTime() + 601_000); } };
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
  const sectionText = "# Lesson\n## 引导问题\n问题\n## 概念\n概念\n## 示范\n示范\n## 边界\n边界\n## 练习\n练习\n---\n## 参考分析\n分析\n## 自查\n自查\n## 记忆提示\n提示";
  const unreviewedLink = await service.prepare(f.owner, randomUUID(), lesson);
  await assert.rejects(service.submit(f.owner, unreviewedLink.id, randomUUID(), command(unreviewedLink, { content: sectionText,
    references: "https://invalid.example/unreviewed" })), invalid);
  const missingSection = await service.prepare(f.owner, randomUUID(), lesson);
  await assert.rejects(service.submit(f.owner, missingSection.id, randomUUID(), command(missingSection, { content: "几句正文",
    references: "仅使用已核对资料" })), invalid);
  const allowed = await service.prepare(f.owner, randomUUID(), lesson);
  const receipt = await service.submit(f.owner, allowed.id, randomUUID(), command(allowed, {
    content: sectionText, references: "仅使用已核对资料",
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
