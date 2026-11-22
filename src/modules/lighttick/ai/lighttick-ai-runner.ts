import {selectionOption} from "../personal-model/personal-model.dispatcher.ts";
import { LightTickPlanningAiRunner } from "../planning/planning-ai-runner.ts";
import type { LLMManager } from "../../../services/llm-manager.ts";
import { ApplicationError } from "../../../shared/errors.ts";
import type { LightTickRepository } from "../lighttick.repository.ts";
import type { LightTickAiRunRow, LightTickOwner } from "../lighttick.types.ts";
import { LightTickAiFinalizer } from "./lighttick-ai-finalize.ts";
import { aiGenerationFallback, prepareAiGeneration, prepareNextWeekGeneration, validateAiGeneration } from "./lighttick-ai-generation.ts";
import { LIGHTTICK_AI_SCENES, type LightTickAiSceneName } from "./lighttick-ai-scenes.ts";
import { LIGHTTICK_PROMPT_VERSION } from "./lighttick-ai-prompts.ts";
import { assertNextWeekAiEnabled, assertNextWeekContextCurrent, type NextWeekContext } from "../next-week-advice.ts";

export class LightTickAiRunner {
  constructor(private readonly repository: LightTickRepository, private readonly llm: Pick<LLMManager, "complete">,
    private readonly clock = () => new Date(),
    private readonly resolveScene = async (name: LightTickAiSceneName) => LIGHTTICK_AI_SCENES[name],
    private readonly authorizeOwner: (owner: LightTickOwner) => Promise<void> = async () => {},
    private readonly nextWeekAvailable: () => Promise<boolean> = async () => false) {}

  async execute(owner: LightTickOwner, runId: string, sceneName: LightTickAiSceneName): Promise<LightTickAiRunRow> {
    await this.authorizeOwner(owner);
    if(['learning_route','learning_lesson','learning_practice_review','learning_tutor'].includes(sceneName))throw new ApplicationError(400,'VALIDATION_ERROR','Use durable learning work for course scenes.');
    let run = await this.repository.getAiRun(owner, runId);
    if (!run) throw new ApplicationError(404, "LIGHTTICK_RESOURCE_NOT_FOUND", "AI run was not found.");
    if ((sceneName === "next_week_advice" || run.kind === "next_week_advice" || run.sceneKey === LIGHTTICK_AI_SCENES.next_week_advice.key) &&
        (sceneName !== "next_week_advice" || run.kind !== "next_week_advice" || run.sceneKey !== LIGHTTICK_AI_SCENES.next_week_advice.key))
      throw new ApplicationError(409, "LIGHTTICK_VERSION_CONFLICT", "Run is not a weekly suggestion.");
    if (run.inputContext.browser_generation_id) return run;
    if (run.inputContext.planning_session_id) return await new LightTickPlanningAiRunner(this.repository,this.llm,this.clock,this.resolveScene,this.authorizeOwner).execute(owner,runId);
    if (!["queued", "failed"].includes(run.status)) return run;
    const scene = await this.resolveScene(sceneName); const started = this.clock();
    const original = run;
    const finalizer = new LightTickAiFinalizer(this.repository, this.clock, this.authorizeOwner, this.nextWeekAvailable);
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
      let generation;
      if (sceneName === "next_week_advice") {
        const current = await this.repository.transaction(owner, async () => {
          await this.repository.lockPlanningOwner(owner);
          await this.authorizeOwner(owner);
          assertNextWeekAiEnabled(await this.nextWeekAvailable());
          return await assertNextWeekContextCurrent(this.repository, owner, run.inputContext.next_week as NextWeekContext, this.clock());
        });
        generation = prepareNextWeekGeneration(current, scene);
      } else {
        const original = await prepareAiGeneration(this.repository, owner, sceneName, run.inputContext, scene, this.clock);
        prepared = original;
        generation = { request: original.request, validate: (output: string) => validateAiGeneration(original, output, this.clock) };
      }
      await this.authorizeOwner(owner);
      if (sceneName === "next_week_advice") assertNextWeekAiEnabled(await this.nextWeekAvailable());
      const result = await this.llm.complete({
        ...generation.request,
        providerOptions: { ...selectionOption(run.inputContext.model_selection), response_format: { type: "json_object" }, enable_thinking: false,
          ...(sceneName === "next_week_advice" ? { zookLogBodyMode: "suppress" } : {}) },
        usageOwner: { appId: owner.appId, userId: owner.userId },
      });
      const output = generation.validate(result.text);
      return await finalizer.complete(owner, run, sceneName, output, result, run.attemptCount + 1, started);
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
      const materializedId = fallback ? await finalizer.materializeOutput(owner, run, sceneName, fallback, "template") : undefined;
      return await this.repository.saveAiRun({ ...current, status: fallback ? "succeeded" : "failed", attemptCount: run.attemptCount + 1,
        resourceId: materializedId ?? run.resourceId, provider: fallback ? "deterministic_template" : run.provider, output: fallback,
        errorCode: fallback ? undefined : error instanceof ApplicationError ? error.code : "LIGHTTICK_AI_UNAVAILABLE",
        usage: {}, latencyMs: completed.getTime() - started.getTime(), startedAt: started.toISOString(), completedAt: completed.toISOString(),
        updatedAt: completed.toISOString() });
      });
    }
  }
}
