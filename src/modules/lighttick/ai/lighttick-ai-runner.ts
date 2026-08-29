import type { LLMManager } from "../../../services/llm-manager.ts";
import { ApplicationError } from "../../../shared/errors.ts";
import type { LightTickRepository } from "../lighttick.repository.ts";
import type { LightTickAiRunRow, LightTickOwner } from "../lighttick.types.ts";
import { assembleLightTickContext } from "./lighttick-ai-context.ts";
import { LIGHTTICK_AI_SCENES, LIGHTTICK_SCENE_PROMPTS, LIGHTTICK_SYSTEM_PROMPT, type LightTickAiSceneName } from "./lighttick-ai-scenes.ts";
import { parseLightTickJson, validatePlanOutput, validateProposalOutput, validateReviewOutput } from "./lighttick-ai-validation.ts";

export class LightTickAiRunner {
  constructor(private readonly repository: LightTickRepository, private readonly llm: Pick<LLMManager, "complete">,
    private readonly clock = () => new Date(),
    private readonly resolveScene = async (name: LightTickAiSceneName) => LIGHTTICK_AI_SCENES[name]) {}

  async execute(owner: LightTickOwner, runId: string, sceneName: LightTickAiSceneName): Promise<LightTickAiRunRow> {
    const run = await this.repository.getAiRun(owner, runId);
    if (!run) throw new ApplicationError(404, "LIGHTTICK_RESOURCE_NOT_FOUND", "AI run was not found.");
    if (!["queued", "failed"].includes(run.status)) return run;
    const scene = await this.resolveScene(sceneName); const started = this.clock();
    await this.repository.saveAiRun({ ...run, status: "running", attemptCount: run.attemptCount + 1,
      startedAt: started.toISOString(), updatedAt: started.toISOString() });
    try {
      const context = await assembleLightTickContext(this.repository, owner, run.inputContext);
      const result = await this.llm.complete({ modelKey: scene.modelAlias, messages: [
        { role: "system", content: LIGHTTICK_SYSTEM_PROMPT },
        { role: "user", content: `${LIGHTTICK_SCENE_PROMPTS[sceneName]}\nINPUT_JSON=${JSON.stringify(context)}` },
      ], temperature: 0.2, maxTokens: scene.maxOutputTokens, usageOwner: { appId: owner.appId, userId: owner.userId } });
      const output = this.validate(sceneName, parseLightTickJson(result.text), context);
      const completed = this.clock();
      return await this.repository.saveAiRun({ ...run, status: "succeeded", attemptCount: run.attemptCount + 1,
        provider: result.provider, model: result.providerModel, output, usage: result.usage ?? {},
        latencyMs: completed.getTime() - started.getTime(), startedAt: started.toISOString(), completedAt: completed.toISOString(),
        updatedAt: completed.toISOString() });
    } catch (error) {
      const completed = this.clock(); const fallback = this.fallback(scene.fallback, run.inputContext);
      return await this.repository.saveAiRun({ ...run, status: fallback ? "succeeded" : "failed", attemptCount: run.attemptCount + 1,
        provider: fallback ? "deterministic_template" : run.provider, output: fallback,
        errorCode: fallback ? undefined : error instanceof ApplicationError ? error.code : "LIGHTTICK_AI_UNAVAILABLE",
        usage: {}, latencyMs: completed.getTime() - started.getTime(), startedAt: started.toISOString(), completedAt: completed.toISOString(),
        updatedAt: completed.toISOString() });
    }
  }

  private validate(scene: LightTickAiSceneName, output: Record<string, unknown>, context: any) {
    if (["onboarding_plan", "month_plan", "week_plan", "day_plan"].includes(scene)) return validatePlanOutput(output, {
      availableMinutes: Number(context.request.available_minutes ?? context.goal?.constraints?.weekly_available_minutes ?? 300),
      periodStart: String(context.request.period_start ?? new Date().toISOString().slice(0, 10)),
      periodEnd: String(context.request.period_end ?? context.request.period_start ?? new Date().toISOString().slice(0, 10)),
    });
    if (["weekly_review", "monthly_review"].includes(scene)) return validateReviewOutput(output);
    if (scene === "change_proposal") return validateProposalOutput(output, new Set(context.tasks.map((task: any) => task.id)));
    if (typeof output.message !== "string" || output.message.length > 2000)
      throw new ApplicationError(502, "LIGHTTICK_AI_RUN_FAILED", "Coach output does not match its schema.");
    return output;
  }

  private fallback(policy: string, input: Record<string, unknown>) {
    if (policy === "facts_only") return { insights: [], recommendations: [], source: "facts_only" };
    if (policy === "template") return { tasks: [{ title: "Review goal and choose the next smallest step",
      estimated_minutes: Math.min(30, Number(input.available_minutes ?? 30)), priority: 100 }], source: "deterministic_template" };
    return undefined;
  }
}
