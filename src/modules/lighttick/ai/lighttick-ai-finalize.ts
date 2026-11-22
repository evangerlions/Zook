import type { LLMCompletionResult } from "../../../services/llm-manager-types.ts";
import { randomId } from "../../../shared/utils.ts";
import { taskDetailsFromOutput } from "../lighttick-task-details.ts";
import { LightTickPlanService } from "../lighttick-plan.service.ts";
import type { LightTickRepository } from "../lighttick.repository.ts";
import type { LightTickAiRunRow, LightTickOwner } from "../lighttick.types.ts";
import type { LightTickAiSceneName } from "./lighttick-ai-scenes.ts";
import { assertNextWeekAiEnabled, assertNextWeekContextCurrent, type NextWeekContext } from "../next-week-advice.ts";
import { annualDraftScene, assertAnnualDraftAvailable, requireCurrentAnnualDraftContext, type AnnualDraftSnapshot } from "../planning/annual-draft-context.ts";
import { buildAnnualDraftOutput } from "../planning/annual-draft-generation.ts";

export class LightTickAiFinalizer {
  constructor(private readonly repository: LightTickRepository, private readonly clock: () => Date,
    private readonly authorizeOwner: (owner: LightTickOwner) => Promise<void>,
    private readonly planningReviewAvailable: (scene: "next_week_advice" | typeof annualDraftScene) => Promise<boolean> = async () => false) {}

  async complete(owner: LightTickOwner, run: LightTickAiRunRow, scene: LightTickAiSceneName,
    output: Record<string, unknown>, result: Pick<LLMCompletionResult, "provider" | "providerModel" | "usage">,
    expectedAttempt: number, started: Date) {
    return this.repository.transaction(owner, async () => {
      if (scene === "next_week_advice" || scene === annualDraftScene) await this.repository.lockPlanningOwner(owner);
      const current = await this.repository.getAiRun(owner, run.id);
      if (!current) return { ...run, status: "failed", errorCode: "LIGHTTICK_RESOURCE_NOT_FOUND" };
      if (current.status !== "running" || current.attemptCount !== expectedAttempt) return current;
      await this.authorizeOwner(owner);
      if (scene === "next_week_advice") {
        assertNextWeekAiEnabled(await this.planningReviewAvailable("next_week_advice"));
        await assertNextWeekContextCurrent(this.repository, owner, current.inputContext.next_week as NextWeekContext, this.clock());
      }
      let finalOutput = output;
      if (scene === annualDraftScene) {
        assertAnnualDraftAvailable(await this.planningReviewAvailable(annualDraftScene));
        const context = await requireCurrentAnnualDraftContext(this.repository, owner,
          current.inputContext.annual_draft as AnnualDraftSnapshot, this.clock());
        finalOutput = buildAnnualDraftOutput(output, context);
      }
      const materializedId = await this.materializeOutput(owner, run, scene, finalOutput, "ai", result.providerModel);
      await this.authorizeOwner(owner);
      const completed = this.clock();
      return this.repository.saveAiRun({
        ...run, status: "succeeded", attemptCount: expectedAttempt,
        resourceId: materializedId ?? run.resourceId, provider: result.provider, model: result.providerModel,
        output: finalOutput, usage: { ...result.usage }, latencyMs: completed.getTime() - started.getTime(),
        startedAt: started.toISOString(), completedAt: completed.toISOString(), updatedAt: completed.toISOString(),
      });
    });
  }

  async materializeOutput(owner: LightTickOwner, run: LightTickAiRunRow, sceneName: LightTickAiSceneName,
    output: Record<string, unknown>, source: "ai" | "template", model?: string): Promise<string | undefined> {
    await this.authorizeOwner(owner);
    if (sceneName === "next_week_advice" || sceneName === annualDraftScene) return undefined;
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
