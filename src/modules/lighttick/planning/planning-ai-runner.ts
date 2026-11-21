import {selectionOption} from "../personal-model/personal-model.dispatcher.ts";
import type { LLMManager } from "../../../services/llm-manager.ts";
import type { LightTickRepository } from "../lighttick.repository.ts";
import type { LightTickAiRunRow, LightTickOwner } from "../lighttick.types.ts";
import { LIGHTTICK_AI_SCENES, type LightTickAiSceneName } from "../ai/lighttick-ai-scenes.ts";
import { LIGHTTICK_PROMPT_VERSION } from "../ai/lighttick-ai-prompts.ts";
import { preparePlanningGeneration, validatePlanningGeneration } from "./planning-ai-generation.ts";
import { finalizePlanningGeneration } from "./planning-ai-finalize.ts";
import { LightTickPlanningService } from "./planning.service.ts";
import { planningError, readyState } from "./planning-context.ts";

export class LightTickPlanningAiRunner {
  constructor(private readonly repository: LightTickRepository, private readonly llm: Pick<LLMManager,"complete">, private readonly clock = () => new Date(),
    private readonly resolveScene = async (name:LightTickAiSceneName) => LIGHTTICK_AI_SCENES[name],
    private readonly authorizeOwner: (owner: LightTickOwner) => Promise<void> = async () => {}) {}
  async execute(owner: LightTickOwner, runId: string): Promise<LightTickAiRunRow> {
    const service = new LightTickPlanningService(this.repository, this.clock);
    const claim = await this.repository.transaction(owner, async () => {
      await this.authorizeOwner(owner);
      await this.repository.lockPlanningOwner(owner);
      const run = await this.repository.getAiRun(owner, runId);
      if (!run) planningError(404,"LIGHTTICK_RESOURCE_NOT_FOUND","Run was not found.");
      if (run!.inputContext.browser_generation_id || ["succeeded","failed"].includes(run!.status)) return { run:run!, execute:false };
      const session = await this.repository.getPlanningSession(owner,String(run!.inputContext.planning_session_id));
      if (!session || session.activeRunId !== runId || session.contextRevision !== run!.inputContext.context_revision) {
        if (session?.activeRunId === runId) await service.save(readyState({ ...session, activeRunId:undefined, lastError:"LIGHTTICK_PLANNING_STALE" }));
        return { run: await this.repository.saveAiRun({ ...run!, status:"failed",errorCode:"LIGHTTICK_PLANNING_STALE",updatedAt:this.clock().toISOString() }), execute:false };
      }
      // Retried delivery gets a new attempt token; only the latest attempt can persist output.
      return { run: await this.repository.saveAiRun({ ...run!,status:"running",attemptCount:run!.attemptCount+1,
        promptVersion:LIGHTTICK_PROMPT_VERSION,startedAt:this.clock().toISOString(),updatedAt:this.clock().toISOString() }), execute:true };
    });
    if (!claim.execute) return claim.run;
    const run = claim.run; const clarify = run.inputContext.planning_action === "messages";
    const name = clarify ? "planning_clarify" : "week_plan";
    let output: Record<string, any> | undefined; let result: any; let failure: string | undefined;
    try {
      const scene = await this.resolveScene(name);
      const prepared = await preparePlanningGeneration(this.repository, owner, run, scene);
      await this.authorizeOwner(owner);
      const controller = new AbortController();
      const timeout = new Error("Planning model deadline exceeded");
      let timer: ReturnType<typeof setTimeout> | undefined;
      const deadline = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
          reject(timeout);
          controller.abort(timeout);
        }, scene.timeoutMs);
      });
      try {
        result = await Promise.race([
          this.llm.complete({
            ...prepared.request,
            signal: controller.signal,
            providerOptions: { ...selectionOption(run.inputContext.model_selection), response_format: { type: "json_object" }, enable_thinking: false },
            usageOwner: owner,
          }),
          deadline,
        ]);
      } finally {
        clearTimeout(timer);
      }
      output = validatePlanningGeneration(prepared, result.text);
    } catch (error: any) { failure = error?.code === "LIGHTTICK_PLANNING_CONTEXT_TOO_LARGE" ? error.code : "LIGHTTICK_AI_UNAVAILABLE"; }
    return finalizePlanningGeneration(service, owner, run, output, result, failure, this.authorizeOwner);
  }
}
