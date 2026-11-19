import { createHash } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { InMemoryJobQueue } from "../src/infrastructure/queue/bullmq/in-memory-queue.ts";
import { InMemoryLightTickRepository } from "../src/testing/in-memory-lighttick-repository.ts";
import { LightTickGoalService } from "../src/modules/lighttick/lighttick-goal.service.ts";
import { LightTickTaskService } from "../src/modules/lighttick/lighttick-task.service.ts";
import { NativeLearningService } from "../src/modules/lighttick/learning/native-learning.service.ts";
import { LearningRouteService } from "../src/modules/lighttick/learning/learning-route.service.ts";
import { LearningWorkService } from "../src/modules/lighttick/learning/learning-work.service.ts";
import { LearningWorkRunner } from "../src/modules/lighttick/learning/learning-work.runner.ts";
import { LearningSchedulingService } from "../src/modules/lighttick/learning/learning-scheduling.service.ts";
import { ManualPlanningService } from "../src/modules/lighttick/manual/manual-planning.service.ts";
import { LIGHTTICK_AI_SCENES } from "../src/modules/lighttick/ai/lighttick-ai-scenes.ts";
import { LIGHTTICK_PROMPT_VERSION } from "../src/modules/lighttick/ai/lighttick-ai-prompts.ts";
import { ApplicationError } from "../src/shared/errors.ts";
import type { LLMCompletionRequest, LLMCompletionResult } from "../src/services/llm-manager-types.ts";
import type { LearningScheduleDraft } from "../src/modules/lighttick/learning/learning-scheduling.service.ts";
import type { LightTickRepository } from "../src/modules/lighttick/lighttick.repository.ts";
import { actualCost, evaluateBudget, loadQualityRoute, qualityScenes, type RateCard } from "./lib/lighttick-learning-quality-transport.ts";

interface Sample {
  id: string; family: string; goal: string; level: string; variant: string;
  available_daily_minutes: number; available_weekly_minutes: number; scenario: string;
}
interface Material { title: string; text: string; reference?: string; }
const fixtures = new URL("../test/fixtures/", import.meta.url);
const clock = () => new Date("2026-11-19T04:00:00.000Z");
const start = "2026-11-19", end = "2026-11-22";
const digest = (value: string) => createHash("sha256").update(value).digest("hex");
const errorCode = (error: unknown) => error && typeof error === "object" && "code" in error ? String(error.code) : "EVALUATION_FAILED";
const json = async (path: string | URL) => JSON.parse(await readFile(path, "utf8"));

export async function evaluateQualityCase(
  sample: Sample, material: Material, invoke: (request: LLMCompletionRequest) => Promise<LLMCompletionResult>, rates: RateCard,
) {
  // This fixture exercises the learning and planning methods of the test store.
  const repo = new InMemoryLightTickRepository() as unknown as LightTickRepository;
  const owner = { appId: "lighttick" as const, userId: "a3-quality-" + sample.id };
  const native = new NativeLearningService(repo, true, clock);
  const routes = new LearningRouteService(native);
  const service = new LearningWorkService(routes, new InMemoryJobQueue(), () => true);
  const goal = await new LightTickGoalService(repo, clock).create(owner, {
    title: sample.goal, constraints: { weekly_available_minutes: sample.available_weekly_minutes },
  });
  const routeId = "plan-quality-" + sample.id;
  const minutes = Math.min(15, Math.floor(sample.available_daily_minutes * 0.8));
  const brief = { title: sample.goal, goal: sample.goal + "。" + sample.scenario, level: sample.level,
    minutes, pacing: "self_paced", lesson_count: 2 };
  const source = material.text + (material.reference ? "\n来源：" + material.reference : "");
  const observations: Record<string, unknown>[] = [];
  const worker = new LearningWorkRunner(service, { complete: async request => {
    const before = Date.now();
    let response: LLMCompletionResult;
    try {
      response = await invoke(request);
    } catch (error) {
      const upstreamHttpStatus = error instanceof ApplicationError && error.details && typeof error.details === "object"
        ? (error.details as Record<string, unknown>).statusCode : undefined;
      observations.push({ latency_ms: Date.now() - before, error_code: errorCode(error), estimated_cost_usd: null,
        ...(typeof upstreamHttpStatus === "number" && Number.isInteger(upstreamHttpStatus) ? { upstream_http_status: upstreamHttpStatus } : {}),
      });
      throw error;
    }
    const usage = response.usage;
    const validUsage = !!usage && !usage.estimated && [usage.promptTokens, usage.completionTokens].every(n => Number.isFinite(n) && n >= 0);
    observations.push({ provider: response.provider, model: response.providerModel, latency_ms: Date.now() - before,
      usage: usage ?? null, estimated_cost_usd: validUsage ? actualCost(usage, rates) : null,
      finish_reason: response.finishReason ?? null, raw_output: response.text });
    if (response.finishReason === "length") throw Error("The provider truncated the evaluation output.");
    return response;
  } }, { readFile: async () => { throw Error("Fixed evaluation source required."); }, fetchUrl: async () => { throw Error("Fixed evaluation source required."); } });
  const stages: Record<string, unknown>[] = [];
  const facts = async () => digest(JSON.stringify(await repo.listTasks(owner)));
  const versions: Record<string, string | number> = { material_sha256: digest(source) };
  async function run(kind: "route_draft" | "lesson_draft" | "schedule_draft", base: number, input: Record<string, unknown>) {
    const before = await facts();
    const work = await service.create(owner, { kind, route_id: routeId, base_revision: base, ...input }, "quality-" + kind);
    await worker.execute(owner, work.id);
    const result = await service.read(owner, work.id);
    const unchanged = before === await facts();
    stages.push({ kind, status: result.status, error_code: result.error_code, output: result.output, no_automatic_task_write: unchanged });
    if (result.status !== "succeeded" || !unchanged) throw Error("Learning stage failed or wrote tasks before confirmation.");
    return result;
  }
  try {
    if (sample.variant === "interrupted" || sample.id === "existing-course-2") {
      const manual = new ManualPlanningService(repo, clock);
      const plan = await manual.create(owner, "quality-existing-plan", {
        goal_id: goal.id, title: "原有安排", completion_criteria: "", period_start: start, period_end: end,
        tasks: [{ id: "quality-existing-task", title: "原有行动", scheduled_for: start, estimated_minutes: minutes,
          completion_criteria: "保留既有事实", guidance: "" }],
      });
      await manual.confirm(owner, plan.id, "quality-existing-confirm", { base_version: plan.version, goal_base_version: plan.goal_version });
    }
    let draftRevision: number;
    if (sample.family === "existing-course") {
      const document = { prerequisites: "阅读已发布课次", stages: [{ title: "练习", goal: sample.goal }],
        lessons: [
          { number: 1, topic: "原课练习", goal: "区分事实与推断", exercise: "写出核验动作", assessment: "保留原出处", minutes, stage: 1, kind: "lesson", requires: [] },
          { number: 2, topic: "复习与应用", goal: "迁移到新例子", exercise: "复用练习", assessment: "说明依据", minutes, stage: 1, kind: "review", requires: [1] },
        ] };
      draftRevision = (await routes.save(owner, routeId, { base_revision: 0, brief, document }, "quality-prepare-course")).revision;
    } else {
      const output = await run("route_draft", 0, { brief });
      await service.adopt(owner, output.id, { base_revision: output.revision, base_route_revision: 0, expected_digest: output.output_digest }, "quality-adopt-route");
      draftRevision = 1;
    }
    const published = await routes.publish(owner, routeId, { base_revision: draftRevision }, "quality-publish-route");
    versions.route = published.published_version;
    if (sample.family === "existing-course") {
      const lesson = await routes.publishLesson(owner, routeId, 1, { base_revision: published.revision,
        base_lesson_revision: 0, lesson_id: "lesson-quality-existing", content: source, references: material.title }, "quality-publish-fixture");
      if (["existing-course-3", "existing-course-4"].includes(sample.id))
        await native.privateCommand(owner, lesson.id, { action: "complete", content_version: lesson.content_version, base_revision: 0 }, "quality-finish-existing");
    } else {
      const output = await run("lesson_draft", published.revision, { number: 1, sources: [{ kind: "text", title: material.title, text: source }] });
      await service.adopt(owner, output.id, { base_revision: output.revision, base_route_revision: published.revision, expected_digest: output.output_digest }, "quality-adopt-lesson");
    }
    const route = await routes.require(owner, routeId);
    const publishedLesson = (await repo.learningRoutes.listRouteLessonLinks(owner, routeId))[0];
    versions.lesson = publishedLesson.firstContentVersion;
    const latestGoal = (await repo.getGoal(owner, goal.id))!;
    const result = await run("schedule_draft", route.revision, { schedule: { goal_id: goal.id, goal_base_version: latestGoal.version,
      period_start: start, period_end: end, available_daily_minutes: sample.available_daily_minutes,
      available_weekly_minutes: sample.available_weekly_minutes } });
    const proposal = result.output?.suggestion as LearningScheduleDraft;
    const scheduling = new LearningSchedulingService(native, new LightTickTaskService(repo, clock), async () => {});
    const before = await facts();
    if (proposal.items.length) await scheduling.draft(owner, "quality-preview-without-confirmation", proposal);
    if (before !== await facts()) throw Error("Preview wrote tasks before confirmation.");
    return { status: "awaiting_review", stages, observations, source_versions: versions, no_unreviewed_task_write: true };
  } catch (error) {
    return { status: "failed", error_code: errorCode(error), stages, observations, source_versions: versions };
  }
}

async function main() {
  const { values: args } = parseArgs({ options: {
    out: { type: "string" }, mode: { type: "string", default: "prepare" }, "env-file": { type: "string" },
    model: { type: "string", default: "novel-structured" }, provider: { type: "string" },
    rates: { type: "string" }, "ceiling-usd": { type: "string" }, "medical-review": { type: "string" },
  } });
  if (!args.out || !["prepare", "preflight", "run"].includes(args.mode)) throw Error("Provide --out and a supported --mode.");
  const fixture = await json(new URL("lighttick-learning-execution-quality-inputs.json", fixtures)) as { cases: Sample[] };
  const materials = await json(new URL("lighttick-learning-execution-quality-materials.json", fixtures)) as Record<string, Material>;
  if (fixture.cases.length !== 24 || new Set(fixture.cases.map(c => c.id)).size !== 24 ||
      fixture.cases.some(c => !materials[c.id]?.text)) throw Error("The fixed evaluation requires 24 distinct inputs and sources.");
  const generatedCases = fixture.cases.filter(c => c.family !== "existing-course").length;
  const fullCounts = { learning_route: generatedCases, learning_lesson: generatedCases, learning_schedule: fixture.cases.length };
  const report = {
    candidate: execFileSync("git", ["rev-parse", "HEAD"], { encoding: "utf8" }).trim(),
    fixtures_business_date: start, prompt_version: LIGHTTICK_PROMPT_VERSION, real_cases: 0, provider_calls: 0,
    scene_versions: qualityScenes.map(name => ({
      name, key: LIGHTTICK_AI_SCENES[name].key, schema: LIGHTTICK_AI_SCENES[name].schemaVersion,
      max_calls: fullCounts[name], internal_cost_ceiling_usd_per_call: LIGHTTICK_AI_SCENES[name].maxEstimatedCostUsd,
    })),
    status: "prepared", blocked_reason: null as string | null, route: null as unknown, budget: null as unknown,
    cases: fixture.cases.map(input => {
      const material = materials[input.id];
      return { input, material, material_sha256: digest(material.text + (material.reference ? "\n来源：" + material.reference : "")),
        result: null as unknown, human_review: null };
    }),
  };
  const path = resolve(args.out, "review.json");
  await mkdir(resolve(args.out), { recursive: true, mode: 0o700 });
  const record = (first = false) => writeFile(path, JSON.stringify(report, null, 2) + "\n", { flag: first ? "wx" : "w", mode: 0o600 });
  await record(true);
  if (args.mode === "prepare") {
    console.log("Prepared 24 cases. No provider called.");
    return;
  }
  let route: Awaited<ReturnType<typeof loadQualityRoute>>;
  let rates: RateCard;
  let approved: string[] = [];
  try {
    if (args["env-file"]) process.loadEnvFile(args["env-file"]);
    if (!process.env.REDIS_URL) throw Error("The existing Zook Redis connection is required.");
    route = await loadQualityRoute(process.env.REDIS_URL, args.model, args.provider);
    report.route = route.metadata;
    if (!args.rates) throw Error("A verified rate card for the selected route is required.");
    rates = await json(args.rates) as RateCard;
    if (args["medical-review"]) {
      const admissions = await json(args["medical-review"]) as { case_id: string; reviewer: string; reviewed_at: string; source_sha256: string }[];
      approved = admissions.filter(a => {
        const material = materials[a.case_id];
        return material && a.reviewer?.trim() && Number.isFinite(Date.parse(a.reviewed_at)) &&
          a.source_sha256 === digest(material.text + (material.reference ? "\n来源：" + material.reference : ""));
      }).map(a => a.case_id);
    }
    const enabledCases = fixture.cases.filter(c => c.family !== "medical-literacy" || approved.includes(c.id));
    const generated = enabledCases.filter(c => c.family !== "existing-course").length;
    report.budget = evaluateBudget({ learning_route: generated, learning_lesson: generated, learning_schedule: enabledCases.length },
      route.metadata, rates, Number(args["ceiling-usd"]));
    report.status = "budget_verified";
  } catch (error) {
    report.status = "blocked";
    report.blocked_reason = error instanceof Error && error.constructor === Error ? error.message : "Zook configuration or budget preflight failed.";
    await record();
    console.log(JSON.stringify({ status: report.status, reason: report.blocked_reason, provider_calls: 0 }));
    process.exitCode = 2;
    return;
  }
  await record();
  if (args.mode === "preflight") {
    console.log(JSON.stringify({ status: report.status, budget: report.budget, provider_calls: 0 }));
    return;
  }
  for (const c of report.cases) {
    if (c.input.family === "medical-literacy" && !approved.includes(c.input.id)) {
      c.result = { status: "material_review_required" };
    } else {
      const result = await evaluateQualityCase(c.input, c.material, async request => {
        report.provider_calls++;
        return route.complete(request);
      }, rates);
      c.result = result;
      if (result.observations.some(item => item.upstream_http_status === 401)) {
        report.status = "blocked";
        report.blocked_reason = "The selected provider rejected the model credential (HTTP 401).";
        await record();
        console.log(JSON.stringify({ status: report.status, reason: report.blocked_reason,
          real_cases: report.real_cases, provider_calls: report.provider_calls }));
        process.exitCode = 2;
        return;
      }
      if (result.status === "awaiting_review" && result.observations.length > 0 &&
          result.observations.every(item => item.estimated_cost_usd !== null)) report.real_cases++;
    }
    await record();
  }
  report.status = report.real_cases === 24 ? "awaiting_human_review" : "incomplete";
  await record();
  console.log(JSON.stringify({ status: report.status, real_cases: report.real_cases, provider_calls: report.provider_calls }));
  if (report.real_cases !== 24) process.exitCode = 1;
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  void main().catch(() => { console.error("Could not prepare or write the A3 evaluation. Check the options and unused output directory."); process.exitCode = 1; });
}
