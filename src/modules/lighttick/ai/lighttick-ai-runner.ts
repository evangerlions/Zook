import {selectionOption} from "../personal-model/personal-model.dispatcher.ts";
import { LightTickPlanningAiRunner } from "../planning/planning-ai-runner.ts";
import { taskDetailsFromOutput } from "../lighttick-task-details.ts";
import type { LLMManager } from "../../../services/llm-manager.ts";
import { ApplicationError } from "../../../shared/errors.ts";
import { randomId } from "../../../shared/utils.ts";
import type { LightTickRepository } from "../lighttick.repository.ts";
import type { LightTickAiRunRow, LightTickOwner } from "../lighttick.types.ts";
import { LightTickPlanService } from "../lighttick-plan.service.ts";
import { aiGenerationFallback, prepareAiGeneration, validateAiGeneration } from "./lighttick-ai-generation.ts";
import { LIGHTTICK_AI_SCENES, type LightTickAiSceneName } from "./lighttick-ai-scenes.ts";
import { LIGHTTICK_PROMPT_VERSION } from "./lighttick-ai-prompts.ts";

export class LightTickAiRunner {
  constructor(private readonly repository: LightTickRepository, private readonly llm: Pick<LLMManager, "complete">,
    private readonly clock = () => new Date(),
    private readonly resolveScene = async (name: LightTickAiSceneName) => LIGHTTICK_AI_SCENES[name],
    private readonly authorizeOwner: (owner: LightTickOwner) => Promise<void> = async () => {}) {}

  async execute(owner: LightTickOwner, runId: string, sceneName: LightTickAiSceneName): Promise<LightTickAiRunRow> {
    await this.authorizeOwner(owner);
    if(sceneName==='learning_route'||sceneName==='learning_lesson'||sceneName==='learning_practice_review')throw new ApplicationError(400,'VALIDATION_ERROR','Use durable learning work for course scenes.');
    let run = await this.repository.getAiRun(owner, runId);
    if (!run) throw new ApplicationError(404, "LIGHTTICK_RESOURCE_NOT_FOUND", "AI run was not found.");
    if (run.inputContext.planning_session_id) return await new LightTickPlanningAiRunner(this.repository,this.llm,this.clock,this.resolveScene,this.authorizeOwner).execute(owner,runId);
    if (!["queued", "failed"].includes(run.status)) return run;
    const scene = await this.resolveScene(sceneName); const started = this.clock();
    const original = run;
    const claim = await this.repository.transaction(owner, async () => {
      await this.authorizeOwner(owner);
      const current = await this.repository.getAiRun(owner, runId);
      if (!current || !["queued", "failed"].includes(current.status) || current.attemptCount !== original.attemptCount)
        return { execute: false as const, row: current };
      await this.repository.saveAiRun({ ...current, status: "running", attemptCount: current.attemptCount + 1,
        startedAt: started.toISOString(), updatedAt: started.toISOString() });
      return { execute: true as const, row: current };
    });
    if (!claim.execute) return claim.row ?? { ...run, status: "failed", errorCode: "LIGHTTICK_RESOURCE_NOT_FOUND" };
    run = { ...claim.row, promptVersion: LIGHTTICK_PROMPT_VERSION };
    let prepared: Awaited<ReturnType<typeof prepareAiGeneration>> | undefined;
    try {
      prepared = await prepareAiGeneration(this.repository, owner, sceneName, run.inputContext, scene, this.clock);
      await this.authorizeOwner(owner);
      const result = await this.llm.complete({
        ...prepared.request,
        providerOptions: { ...selectionOption(run.inputContext.model_selection), response_format: { type: "json_object" }, enable_thinking: false },
        usageOwner: { appId: owner.appId, userId: owner.userId },
      });
      const output = validateAiGeneration(prepared, result.text, this.clock);
      return await this.repository.transaction(owner, async () => {
      const current = await this.repository.getAiRun(owner, runId);
      if (!current) return { ...run, status: "failed", errorCode: "LIGHTTICK_RESOURCE_NOT_FOUND" };
      if (current.status !== "running" || current.attemptCount !== run.attemptCount + 1) return current;
      await this.authorizeOwner(owner);
      const materializedId = await this.materializeOutput(owner, run, sceneName, output, "ai", result.providerModel);
      await this.authorizeOwner(owner);
      const completed = this.clock();
      return await this.repository.saveAiRun({ ...run, status: "succeeded", attemptCount: run.attemptCount + 1,
        resourceId: materializedId ?? run.resourceId, provider: result.provider, model: result.providerModel, output, usage: result.usage ?? {},
        latencyMs: completed.getTime() - started.getTime(), startedAt: started.toISOString(), completedAt: completed.toISOString(),
        updatedAt: completed.toISOString() });
      });
    } catch (error) {
      const completed = this.clock();
      let fallback: Record<string, unknown> | undefined;
      // Recovery must not bypass authorization or output constraints.
      if (prepared && (run.inputContext.model_selection as any)?.mode !== "personal") {
        try {
          await this.authorizeOwner(owner);
          const candidate = aiGenerationFallback(scene.fallback, run.inputContext, prepared);
          if (candidate) fallback = validateAiGeneration(prepared, candidate, this.clock);
        } catch { /* Preserve original failure; never materialize invalid fallback. */ }
      }
      return await this.repository.transaction(owner, async () => {
      const current = await this.repository.getAiRun(owner, runId);
      if (!current) return { ...run, status: "failed", errorCode: "LIGHTTICK_RESOURCE_NOT_FOUND" };
      if (current.status !== "running" || current.attemptCount !== run.attemptCount + 1) return current;
      try { await this.authorizeOwner(owner); } catch { fallback = undefined; }
      const materializedId = fallback ? await this.materializeOutput(owner, run, sceneName, fallback, "template") : undefined;
      return await this.repository.saveAiRun({ ...current, status: fallback ? "succeeded" : "failed", attemptCount: run.attemptCount + 1,
        resourceId: materializedId ?? run.resourceId, provider: fallback ? "deterministic_template" : run.provider, output: fallback,
        errorCode: fallback ? undefined : error instanceof ApplicationError ? error.code : "LIGHTTICK_AI_UNAVAILABLE",
        usage: {}, latencyMs: completed.getTime() - started.getTime(), startedAt: started.toISOString(), completedAt: completed.toISOString(),
        updatedAt: completed.toISOString() });
      });
    }
  }

  private async materializeOutput(owner: LightTickOwner, run: LightTickAiRunRow, sceneName: LightTickAiSceneName,
    output: Record<string, unknown>, source: "ai" | "template", model?: string): Promise<string | undefined> {
    await this.authorizeOwner(owner);
    if (["onboarding_plan", "month_plan", "week_plan", "day_plan"].includes(sceneName))
      return await this.materializePlan(owner, run, sceneName, output, source);
    if (sceneName === "reading_guide") {
      const articleId = String(run.resourceId ?? run.inputContext.article_id ?? "");
      if (!articleId) return undefined;
      const article = await this.repository.getReadingArticle(owner, articleId);
      if (!article) return undefined;
      const existing = await this.repository.getReadingGuide(owner, articleId);
      const now = this.clock().toISOString();
      // basis 已在 validate 里按服务端判定纠正过（含正文被截断的情况），这里直接采用。
      const saved = await this.repository.saveReadingGuide({
        appId: owner.appId, userId: owner.userId, articleId,
        basis: (output.basis ?? "summary") as "full_text" | "summary",
        corePoints: (output.core_points ?? []) as string[], evidenceLimits: (output.evidence_limits ?? []) as string[],
        languageNotes: (output.language_notes ?? []) as string[], applicationQuestions: (output.application_questions ?? []) as string[],
        model: source === "template" ? "deterministic_template" : (model ?? "unknown"),
        revision: existing?.revision ?? 1, generatedAt: now, updatedAt: now,
      }, existing?.revision);
      return saved.articleId;
    }
    if (["daily_review", "weekly_review", "monthly_review"].includes(sceneName)) {
      const review = (await this.repository.listReviews(owner)).find(item => item.id === run.resourceId);
      if (!review) return undefined;
      // A delayed run cannot erase an already decided review or reopen its actions.
      if (review.output.action_state) return review.id;
      await this.repository.saveReview({ ...review, output: { insights: output.insights ?? [], recommendations: output.recommendations ?? [] },
        status: "ready", version: review.version + 1, updatedAt: this.clock().toISOString() }, review.version);
      return review.id;
    }
    if (sceneName === "change_proposal") {
      const planId = String(run.inputContext.plan_id ?? run.resourceId ?? "");
      const existing = (await this.repository.listProposals(owner, planId)).find(item => item.impact.ai_run_id === run.id);
      if (existing) return existing.id;
      const plan = await this.repository.getPlan(owner, planId);
      if (!plan) return undefined;
      const timestamp = this.clock().toISOString(); const expiresAt = new Date(this.clock().getTime() + 7 * 86_400_000).toISOString();
      const saved = await this.repository.saveProposal({ ...owner, id: randomId("lighttick_proposal"), planId,
        basePlanVersion: Number(run.inputContext.base_version ?? plan.version), status: "pending",
        reason: String(run.inputContext.reason ?? "user_request"), diff: output.diff as unknown[] ?? [],
        impact: { ...(output.impact as Record<string, unknown> ?? {}), ai_run_id: run.id }, expiresAt,
        version: 1, createdAt: timestamp, updatedAt: timestamp });
      return saved.id;
    }
    if (sceneName === "coach_chat") {
      if (typeof output.message !== "string" || !output.message.trim()) return undefined;
      const goalId = String(run.inputContext.goal_id ?? "");
      const threadId = String(run.inputContext.thread_id ?? goalId ?? "default");
      const timestamp = this.clock().toISOString();
      await this.repository.saveChatMessage({ ...owner, id: randomId("lighttick_chat"), threadId, goalId,
        role: "assistant", content: output.message.slice(0, 4000), runId: run.id, createdAt: timestamp });
      return run.id;
    }
    return undefined;
  }

  private async materializePlan(owner: LightTickOwner, run: LightTickAiRunRow, sceneName: LightTickAiSceneName,
    output: Record<string, unknown>, source: "ai" | "template"): Promise<string | undefined> {
    if (!["onboarding_plan", "month_plan", "week_plan", "day_plan"].includes(sceneName)) return undefined;
    const goalId = String(run.inputContext.goal_id ?? run.resourceId ?? "");
    if (!goalId) return undefined;
    const existing = (await this.repository.listPlans(owner, goalId))
      .find(plan => plan.proposal.ai_run_id === run.id);
    if (existing) return existing.id;
    const granularity = sceneName === "month_plan" ? "month" : sceneName === "day_plan" ? "day" : "week";
    const rawTasks = Array.isArray(output.tasks) ? output.tasks as any[] : [];
    const plan = await new LightTickPlanService(this.repository, this.clock).createProposed(owner, {
      goalId, granularity,
      periodStart: String(run.inputContext.period_start ?? this.clock().toISOString().slice(0, 10)),
      periodEnd: String(run.inputContext.period_end ?? run.inputContext.period_start ?? this.clock().toISOString().slice(0, 10)),
      source, tasks: rawTasks.map(task => ({ title: String(task.title), estimatedMinutes: Number(task.estimated_minutes),
        priority: Number.isInteger(task.priority) ? task.priority : undefined, scheduledFor: task.scheduled_for, ...taskDetailsFromOutput(task) })),
      metadata: { ai_run_id: run.id, assumptions: Array.isArray(output.assumptions) ? output.assumptions : [],
        summary: typeof output.summary === "string" ? output.summary : undefined },
    });
    return plan.id;
  }
}
