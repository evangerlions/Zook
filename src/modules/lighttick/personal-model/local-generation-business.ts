import { ApplicationError } from "../../../shared/errors.ts";
import { LIGHTTICK_AI_SCENES } from "../ai/lighttick-ai-scenes.ts";
import { createLightTickAiRun } from "../ai/lighttick-ai-run-record.ts";
import { LightTickAiFinalizer } from "../ai/lighttick-ai-finalize.ts";
import { prepareAiGeneration, validateAiGeneration } from "../ai/lighttick-ai-generation.ts";
import { collectLearningSources } from "../learning/learning-sources.ts";
import { finalizeLearningWork } from "../learning/learning-work-finalize.ts";
import { learningGenerationScene, prepareLearningGeneration, validateLearningGeneration } from "../learning/learning-work-generation.ts";
import { digest, fail, identity, integer, keys, text } from "../learning/native-learning.validation.ts";
import type { LightTickOwner } from "../lighttick.types.ts";
import { preparePlanningGeneration, validatePlanningGeneration } from "../planning/planning-ai-generation.ts";
import { finalizePlanningGeneration } from "../planning/planning-ai-finalize.ts";
import { LightTickPlanningService } from "../planning/planning.service.ts";
import type { ResolveLocalScene } from "./local-generation-rules.ts";
import type { LocalGeneration, LocalGenerationRuntime, LocalGenerationScene, LocalGenerationSnapshot } from "./local-generation.types.ts";

const learningKinds = { learning_route: "route_draft", learning_lesson: "lesson_draft" } as const;
const sourceNeedsReview = async (): Promise<never> => {
  throw new ApplicationError(422, "LIGHTTICK_GENERATION_SOURCE_REVIEW_REQUIRED", "请先收集并核对链接或文件，再选择已核对的资料生成课次。");
};

type Intent = { scene: LocalGenerationScene; input: Record<string, unknown>; planning_session_id?: string };
type Settings = Awaited<ReturnType<ResolveLocalScene>>;
type BrowserFence = { id: string; expiresAt: string };

export class LocalGenerationBusiness {
  private get repository() { return this.runtime.repository; }
  private get planning() { return new LightTickPlanningService(this.repository, this.clock); }

  constructor(private readonly runtime: LocalGenerationRuntime, private readonly clock: () => Date,
    private readonly authorize: () => Promise<void>) {}

  async prepare(owner: LightTickOwner, {scene, input, planning_session_id}: Intent, settings: Settings, fence: BrowserFence) {
    if (scene in learningKinds) return this.prepareLearning(owner, scene as keyof typeof learningKinds, input, settings, fence);
    if (planning_session_id) {
      if (!this.runtime.planningEnabled) fail(503, "Conversational planning is unavailable.");
      if (scene !== "week_plan" && scene !== "planning_clarify") fail(422, "Invalid planning-session generation scene.");
      const clarify = scene === "planning_clarify";
      keys(input, clarify ? ["base_version", "message"] : ["base_version", "context_revision", "instruction", "deep_planning"]);
      if (input.deep_planning !== undefined && typeof input.deep_planning !== "boolean") fail(422, "deep_planning must be a boolean.");
      const start = await this.planning.command(owner, fence.id, clarify ? "messages" : "drafts", planning_session_id, input, this.authorize, fence.id);
      const prepared = await preparePlanningGeneration(this.repository, owner, start.run!, settings);
      const snapshot: LocalGenerationSnapshot = { kind: "planning", clarify, context: prepared.context };
      return { businessType: "run" as const, businessId: start.run!.id, prepared, snapshot };
    }
    if (scene === "planning_clarify") fail(422, "Planning clarification requires a session.");
    keys(input, ["goal_id", "granularity", "period_start", "period_end", "available_minutes", "base_plan_id", "base_version"]);
    const goalId = identity(input.goal_id);
    const granularity = scene.replace(/_plan$/, "");
    if (input.granularity !== undefined && input.granularity !== granularity) fail(422, "Plan granularity does not match the scene.");
    text(input.period_start, 10, true);
    text(input.period_end, 10, true);
    if (input.available_minutes !== undefined) integer(input.available_minutes, 1, 10080);
    if (input.base_plan_id !== undefined || input.base_version !== undefined) {
      const basePlan = await this.repository.getPlan(owner, identity(input.base_plan_id));
      if (basePlan?.goalId !== goalId || basePlan?.version !== integer(input.base_version, 1, 2147483646))
        fail(409, "Plan context changed; refresh before generating.");
    }
    const businessDigest = await this.planning.snapshot(owner, goalId);
    const prepared = await prepareAiGeneration(this.repository, owner, scene, { ...input, granularity }, settings, this.clock);
    if (Buffer.byteLength(prepared.request.messages.map(message => message.content).join("")) > settings.maxContextTokens)
      fail(422, "Planning context exceeds the browser generation capacity.");
    const run = await createLightTickAiRun(this.repository, owner, "plan", scene, goalId, input, this.clock().toISOString(), fence.id);
    const snapshot: LocalGenerationSnapshot = { kind: "plan", context: prepared.context, businessDigest };
    return { businessType: "run" as const, businessId: run.id, prepared, snapshot };
  }

  private async prepareLearning(owner: LightTickOwner, scene: keyof typeof learningKinds, input: Record<string, unknown>,
    settings: Settings, fence: BrowserFence) {
    const service = this.runtime.learningWork;
    if (!service) fail(503, "Learning work is unavailable.");
    const authority = await service.routes.access(owner);
    const created = await service.create(owner, { ...input, kind: learningKinds[scene] }, fence.id, this.authorize, fence);
    const work = (await service.store.get(owner, created.id))!;
    // Text and already reviewed source jobs can be frozen without any I/O inside the owner transaction.
    const sources = work.input.sources
      ? await collectLearningSources(owner, work.input.sources, { readFile: sourceNeedsReview, fetchUrl: sourceNeedsReview }, new AbortController().signal)
      : work.input.collected_sources ?? [];
    const prepared = prepareLearningGeneration(work, sources, settings);
    const snapshot: LocalGenerationSnapshot = { kind: "learning", sources, consentRevision: authority.consentRevision ?? 0 };
    return { businessType: "work" as const, businessId: work.id, prepared, snapshot };
  }

  async accept(owner: LightTickOwner, row: LocalGeneration, raw: string, model: string) {
    const { snapshot } = row.pending!;
    const result = { text: raw, finishReason: "stop", provider: "browser_personal", providerModel: model };
    if (snapshot.kind === "learning") {
      const service = this.runtime.learningWork;
      const work = await this.currentWork(owner, row, snapshot.consentRevision);
      if (!service || !work) {
        if ((await service?.store.get(owner, row.businessId))?.status === "cancelled")
          throw new ApplicationError(409, "LIGHTTICK_GENERATION_CANCELLED", "生成尝试已取消。");
        return this.stale();
      }
      const prepared = { work, sources: snapshot.sources, quotes: [], sceneKey: LIGHTTICK_AI_SCENES[learningGenerationScene(work.kind)].key };
      const output = this.validate(() => validateLearningGeneration(prepared, result));
      const finished = await finalizeLearningWork(service, work, output, null, this.authorize);
      if (finished?.errorCode === "LEARNING_OUTPUT_INVALID") return this.outputInvalid();
      if (finished?.status !== "succeeded") return this.stale();
      return undefined;
    }
    const run = snapshot.kind === "planning" ? await this.repository.getAiRun(owner, row.businessId) : await this.currentRun(owner, row);
    if (!run || run.status !== "running" || run.inputContext.browser_generation_id !== row.id) return this.stale();
    if (snapshot.kind === "planning") {
      if (!this.runtime.planningEnabled || !await this.repository.getGoal(owner, String(run.inputContext.goal_id))) return this.stale();
      const output = this.validate(() => validatePlanningGeneration(snapshot, raw));
      const finished = await finalizePlanningGeneration(this.planning, owner, run, output, result, undefined, this.authorize);
      if (finished.errorCode === "LIGHTTICK_AI_UNAVAILABLE") return this.outputInvalid();
      if (finished.status !== "succeeded") return this.stale();
      return finished.resourceId;
    }
    const started = new Date(run.startedAt ?? run.createdAt);
    const output = this.validate(() => validateAiGeneration({ sceneName: row.scene, context: snapshot.context }, raw, () => started));
    const finished = await new LightTickAiFinalizer(this.repository, this.clock, this.authorize)
      .complete(owner, run, row.scene, output, result, run.attemptCount, started);
    if (finished.status !== "succeeded") return this.stale();
    return finished.resourceId;
  }

  async currentRun(owner: LightTickOwner, row: LocalGeneration) {
    const snapshot = row.pending?.snapshot;
    if (!snapshot || snapshot.kind === "learning") return;
    const run = await this.repository.getAiRun(owner, row.businessId);
    if (!run || run.status !== "running" || run.inputContext.browser_generation_id !== row.id) return;
    const goalId = String(run.inputContext.goal_id);
    if (!await this.repository.getGoal(owner, goalId)) return;
    if (snapshot.kind === "planning") {
      if (!this.runtime.planningEnabled) return;
      const session = await this.repository.getPlanningSession(owner, String(run.inputContext.planning_session_id));
      if (!session || session.activeRunId !== run.id || session.contextRevision !== run.inputContext.context_revision ||
        await this.planning.snapshot(owner, session.goalId) !== run.inputContext.snapshot) return;
    } else {
      const basePlanId = run.inputContext.base_plan_id;
      if (basePlanId && (await this.repository.getPlan(owner, String(basePlanId)))?.version !== run.inputContext.base_version) return;
      if (await this.planning.snapshot(owner, goalId) !== snapshot.businessDigest) return;
    }
    return run;
  }

  async currentWork(owner: LightTickOwner, row: LocalGeneration, consentRevision: number) {
    const service = this.runtime.learningWork;
    const work = await service?.store.get(owner, row.businessId);
    if (!service || !work || work.status !== "running" || work.fence !== row.id || !service.native.enabled) return;
    const authority = await this.repository.getLearningAuthority(owner);
    if (!authority?.readingEnabled || authority.phase !== "zook" || (authority.consentRevision ?? 0) !== consentRevision || authority.epoch !== work.epoch) return;
    const route = await this.repository.learningRoutes.getLearningRoute(owner, work.routeId);
    if ((route?.revision ?? 0) !== work.baseRouteRevision || route?.status === "archived") return;
    return work;
  }

  async stop(owner: LightTickOwner, row: LocalGeneration, code: string) {
    const status = code === "CANCELLED" ? "cancelled" : "failed";
    const updatedAt = this.clock().toISOString();
    if (row.businessType === "work") {
      const store = this.runtime.learningWork?.store;
      const work = await store?.get(owner, row.businessId);
      if (work?.status === "running" && work.fence === row.id) {
        await store!.save({ ...work, status, revision: work.revision + 1, fence: null, leaseUntil: null, errorCode: code, updatedAt }, work.revision);
      }
    } else {
      const run = await this.repository.getAiRun(owner, row.businessId);
      if (run?.status !== "running" || run.inputContext.browser_generation_id !== row.id) return;
      if (run.inputContext.planning_session_id) await this.planning.failRun(owner, run.id, code);
      else await this.repository.saveAiRun({ ...run, status: "failed", errorCode: code, updatedAt, completedAt: updatedAt });
    }
  }

  private outputInvalid(): never {
    throw new ApplicationError(422, "LIGHTTICK_SCENE_OUTPUT_INVALID", "模型结果未通过场景规则校验。请核对输入和模型结果，再明确发起新生成。");
  }

  private stale(): never {
    throw new ApplicationError(409, "LIGHTTICK_GENERATION_CONTEXT_CHANGED", "内容或授权已变化。本次结果无法提交。");
  }

  private validate<T>(validate: () => T): T {
    try { return validate(); }
    catch (error) {
      if (error instanceof Error && "code" in error) return this.outputInvalid();
      if (error instanceof Error && error.message === "fields") return this.outputInvalid();
      throw error;
    }
  }
}
