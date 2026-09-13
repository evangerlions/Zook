import type { LLMManager } from "../../../services/llm-manager.ts";
import type { LightTickRepository } from "../lighttick.repository.ts";
import type { LightTickAiRunRow, LightTickOwner } from "../lighttick.types.ts";
import { LIGHTTICK_AI_SCENES, LIGHTTICK_OUTPUT_SCHEMAS, type LightTickAiSceneName } from "../ai/lighttick-ai-scenes.ts";
import { LIGHTTICK_PROMPT_VERSION, LIGHTTICK_SCENE_PROMPTS, LIGHTTICK_SYSTEM_PROMPT } from "../ai/lighttick-ai-prompts.ts";
import { parseLightTickJson, validatePlanOutput } from "../ai/lighttick-ai-validation.ts";
import { LightTickPlanService } from "../lighttick-plan.service.ts";
import { LightTickPlanningService } from "./planning.service.ts";
import { canonical, planningError, readyState, text, validField, validatePeriod } from "./planning-context.ts";
import type { PlanningField, PlanningSession } from "./planning.types.ts";
import { randomId } from "../../../shared/utils.ts";

export const CLARIFY_SCHEMA = { type: "object", required: ["message", "fields"], additionalProperties: false, properties: {
  message: { type: "string", maxLength: 2000 }, fields: { type: "object", additionalProperties: false, properties:
    Object.fromEntries(["objective","outcome","experience","available_minutes","period_start","period_end","constraints"].map(key=>[key, key === "available_minutes" ? { type:"integer",minimum:1,maximum:10080 } : { type:"string",maxLength:1000 }])) },
} };
export class LightTickPlanningAiRunner {
  constructor(private readonly repository: LightTickRepository, private readonly llm: Pick<LLMManager,"complete">, private readonly clock = () => new Date(),
    private readonly resolveScene = async (name:LightTickAiSceneName) => LIGHTTICK_AI_SCENES[name]) {}
  async execute(owner: LightTickOwner, runId: string): Promise<LightTickAiRunRow> {
    const service = new LightTickPlanningService(this.repository, this.clock);
    const claim = await this.repository.transaction(owner, async () => {
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
      const input = structuredClone(run.inputContext) as any;
      delete input.planning_session_id; delete input.snapshot;
      const context = input.context as PlanningSession["context"];
      const schema = clarify ? CLARIFY_SCHEMA : LIGHTTICK_OUTPUT_SCHEMAS.plan;
      const constraints = clarify ? "Fields are candidate assumptions requiring user review; message must ask at most two questions."
        : `PLAN_CONSTRAINTS: total estimated_minutes at most ${context.available_minutes!.value}; scheduled_for must be from ${context.period_start!.value} through ${context.period_end!.value}.`;
      const prefix = `${LIGHTTICK_SCENE_PROMPTS[name]}\nOUTPUT_JSON_SCHEMA=${JSON.stringify(schema)}\n${constraints}\nINPUT_JSON=`;
      while (Buffer.byteLength(LIGHTTICK_SYSTEM_PROMPT + prefix + JSON.stringify(input)) > scene.maxContextTokens && input.conversation?.length) input.conversation.shift();
      if (Buffer.byteLength(LIGHTTICK_SYSTEM_PROMPT + prefix + JSON.stringify(input)) > scene.maxContextTokens)
        planningError(422,"LIGHTTICK_PLANNING_CONTEXT_TOO_LARGE","Shorten the context before retrying.");
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        result = await Promise.race([this.llm.complete({ modelKey:scene.modelAlias, messages:[{role:"system",content:LIGHTTICK_SYSTEM_PROMPT},{role:"user",content:prefix+JSON.stringify(input)}],
          maxTokens:scene.maxOutputTokens,temperature:0.2,providerOptions:{response_format:{type:"json_object"},enable_thinking:false},usageOwner:owner }),
          new Promise((_,reject)=>{ timer=setTimeout(()=>reject(new Error("timeout")),scene.timeoutMs); })]);
      } finally { if (timer) clearTimeout(timer); }
      output = parseLightTickJson(result.text);
      if (clarify) {
        text(output.message); if (!output.fields || typeof output.fields !== "object" || Array.isArray(output.fields)) throw new Error("fields");
        for (const [key,value] of Object.entries(output.fields)) validField(key,value);
      } else validatePlanOutput(output,{availableMinutes:Number(context.available_minutes!.value),periodStart:String(context.period_start!.value),periodEnd:String(context.period_end!.value)});
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
            tasks:output.tasks.map((task:any)=>({title:task.title,estimatedMinutes:task.estimated_minutes,priority:task.priority,scheduledFor:task.scheduled_for})),
            metadata:{planning_session_id:session.id,context_revision:session.contextRevision,ai_run_id:runId,prompt_version:run.promptVersion} });
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
