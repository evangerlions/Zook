import {selectionOption} from "../personal-model/personal-model.dispatcher.ts";
import { taskDetailsFromOutput } from "../lighttick-task-details.ts";
import type { LLMManager } from "../../../services/llm-manager.ts";
import type { LightTickRepository } from "../lighttick.repository.ts";
import type { LightTickAiRunRow, LightTickOwner } from "../lighttick.types.ts";
import { LIGHTTICK_AI_SCENES, type LightTickAiSceneName } from "../ai/lighttick-ai-scenes.ts";
import { LIGHTTICK_PROMPT_VERSION } from "../ai/lighttick-ai-prompts.ts";
import { preparePlanningGeneration, validatePlanningGeneration } from "./planning-ai-generation.ts";
import { LightTickPlanService } from "../lighttick-plan.service.ts";
import { LightTickPlanningService } from "./planning.service.ts";
import { canonical, planningError, readyState, validField, validatePeriod } from "./planning-context.ts";
import type { PlanningField } from "./planning.types.ts";
import { randomId } from "../../../shared/utils.ts";

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
      if (["succeeded","failed"].includes(run!.status)) return { run:run!, execute:false };
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
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await this.authorizeOwner(owner);
        result = await Promise.race([this.llm.complete({ ...prepared.request,providerOptions:{...selectionOption(run.inputContext.model_selection),response_format:{type:"json_object"},enable_thinking:false},usageOwner:owner }),
          new Promise((_,reject)=>{ timer=setTimeout(()=>reject(new Error("timeout")),scene.timeoutMs); })]);
      } finally { if (timer) clearTimeout(timer); }
      output = validatePlanningGeneration(prepared, result.text);
    } catch (error: any) { failure = error?.code === "LIGHTTICK_PLANNING_CONTEXT_TOO_LARGE" ? error.code : "LIGHTTICK_AI_UNAVAILABLE"; }
    return await this.repository.transaction(owner,async()=>{
      await this.repository.lockPlanningOwner(owner);
      const current = await this.repository.getAiRun(owner,runId);
      if (!current) return { ...run,status:"failed",errorCode:"LIGHTTICK_RESOURCE_NOT_FOUND" }; // Account deletion: never recreate data.
      if (current.attemptCount !== run.attemptCount || current.status !== "running") return current;
      let session = await this.repository.getPlanningSession(owner,String(run.inputContext.planning_session_id));
      const stale = !session || session.activeRunId !== runId || session.contextRevision !== run.inputContext.context_revision ||
        await service.snapshot(owner,session.goalId) !== run.inputContext.snapshot;
      if (stale) failure="LIGHTTICK_PLANNING_STALE";
      try { await this.authorizeOwner(owner); } catch { failure="LIGHTTICK_CAPABILITY_UNAVAILABLE"; }
      let resourceId: string | undefined;
      if (session && !failure && output) {
        if (clarify) {
          const context = structuredClone(session.context);
          for (const [key,value] of Object.entries(output.fields)) {
            if (!context[key as PlanningField] || context[key as PlanningField]!.source === "assumption")
              context[key as PlanningField] = {value:validField(key,value),source:"assumption",source_message_id:String(run.inputContext.source_message_id)};
          }
          try { validatePeriod(context); } catch { failure="LIGHTTICK_AI_UNAVAILABLE"; }
          if (!failure) {
            const changed = canonical(context) !== canonical(session.context);
            session=readyState({ ...session,context,contextRevision:session.contextRevision+(changed?1:0),clarificationRounds:session.clarificationRounds+1,
              draftPlanId:changed?undefined:session.draftPlanId,draftRevision:changed?undefined:session.draftRevision,draftExpiresAt:changed?undefined:session.draftExpiresAt });
            if (!changed && session.draftPlanId) session.status="draft_ready";
            await this.repository.saveChatMessage({ ...owner,id:randomId("lighttick_chat"),goalId:session.goalId,threadId:session.threadId,role:"assistant",content:output.message,runId,createdAt:this.clock().toISOString() });
          }
        } else {
          const plan = await new LightTickPlanService(this.repository,this.clock).createProposed(owner,{ goalId:session.goalId,granularity:"week",
            periodStart:String(session.context.period_start!.value),periodEnd:String(session.context.period_end!.value),source:"ai",
            tasks:output.tasks.map((task:any)=>({title:task.title,estimatedMinutes:task.estimated_minutes,priority:task.priority,scheduledFor:task.scheduled_for,...taskDetailsFromOutput(task)})),
            metadata:{summary:typeof output.summary === "string" ? output.summary : undefined, assumptions:Array.isArray(output.assumptions)?output.assumptions:[], planning_session_id:session.id,context_revision:session.contextRevision,ai_run_id:runId,prompt_version:run.promptVersion} });
          resourceId=plan.id;
          session={ ...session,status:"draft_ready",draftPlanId:plan.id,draftRevision:session.contextRevision,
            draftExpiresAt:new Date(this.clock().getTime()+7*86400000).toISOString(),baseSnapshot:String(run.inputContext.snapshot) };
        }
      }
      if (session?.activeRunId === runId) await service.save(failure ? readyState({ ...session,activeRunId:undefined,lastError:failure }) : { ...session,activeRunId:undefined,lastError:undefined });
      return await this.repository.saveAiRun({ ...current,status:failure?"failed":"succeeded",resourceId,output:failure?undefined:output,errorCode:failure,
        provider:result?.provider,model:result?.providerModel,usage:result?.usage??{},completedAt:this.clock().toISOString(),updatedAt:this.clock().toISOString() });
    });
  }
}
