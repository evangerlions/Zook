import { randomId } from "../../../shared/utils.ts";
import type { LLMCompletionResult } from "../../../services/llm-manager-types.ts";
import type { LightTickAiRunRow, LightTickOwner } from "../lighttick.types.ts";
import { taskDetailsFromOutput } from "../lighttick-task-details.ts";
import { LightTickPlanService } from "../lighttick-plan.service.ts";
import { canonical, readyState, validField, validatePeriod } from "./planning-context.ts";
import { LightTickPlanningService } from "./planning.service.ts";
import type { PlanningField } from "./planning.types.ts";

export async function finalizePlanningGeneration(
  service: LightTickPlanningService,
  owner: LightTickOwner,
  run: LightTickAiRunRow,
  output: Record<string, any> | undefined,
  result: Pick<LLMCompletionResult, "provider" | "providerModel" | "usage"> | undefined,
  failure: string | undefined,
  authorizeOwner: (owner: LightTickOwner) => Promise<void>,
): Promise<LightTickAiRunRow> {
  const { repository, clock } = service;
  const runId = run.id;
  const clarify = run.inputContext.planning_action === "messages";
  return await repository.transaction(owner,async()=>{
    await repository.lockPlanningOwner(owner);
    const current = await repository.getAiRun(owner,runId);
    if (!current) return { ...run,status:"failed",errorCode:"LIGHTTICK_RESOURCE_NOT_FOUND" }; // Account deletion: never recreate data.
    if (current.attemptCount !== run.attemptCount || current.status !== "running") return current;
    let session = await repository.getPlanningSession(owner,String(run.inputContext.planning_session_id));
    const stale = !session || session.activeRunId !== runId || session.contextRevision !== run.inputContext.context_revision ||
      await service.snapshot(owner,session.goalId) !== run.inputContext.snapshot;
    if (stale) failure="LIGHTTICK_PLANNING_STALE";
    try { await authorizeOwner(owner); } catch { failure="LIGHTTICK_CAPABILITY_UNAVAILABLE"; }
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
          await repository.saveChatMessage({ ...owner,id:randomId("lighttick_chat"),goalId:session.goalId,threadId:session.threadId,role:"assistant",content:output.message,runId,createdAt:clock().toISOString() });
        }
      } else {
        const plan = await new LightTickPlanService(repository,clock).createProposed(owner,{ goalId:session.goalId,granularity:"week",
          periodStart:String(session.context.period_start!.value),periodEnd:String(session.context.period_end!.value),source:"ai",
          tasks:output.tasks.map((task:any)=>({title:task.title,estimatedMinutes:task.estimated_minutes,priority:task.priority,scheduledFor:task.scheduled_for,...taskDetailsFromOutput(task)})),
          metadata:{summary:typeof output.summary === "string" ? output.summary : undefined, assumptions:Array.isArray(output.assumptions)?output.assumptions:[], planning_session_id:session.id,
            ...(session.previousPlanId ? { previous_plan_id: session.previousPlanId } : {}),
            ...(session.stageId ? { stage_id: session.stageId } : {}),
            context_revision:session.contextRevision,ai_run_id:runId,prompt_version:run.promptVersion} });
        resourceId=plan.id;
        session={ ...session,status:"draft_ready",draftPlanId:plan.id,draftRevision:session.contextRevision,
          draftExpiresAt:new Date(clock().getTime()+7*86400000).toISOString(),baseSnapshot:String(run.inputContext.snapshot) };
      }
    }
    if (session?.activeRunId === runId) await service.save(failure ? readyState({ ...session,activeRunId:undefined,lastError:failure }) : { ...session,activeRunId:undefined,lastError:undefined });
    return await repository.saveAiRun({ ...current,status:failure?"failed":"succeeded",resourceId,output:failure?undefined:output,errorCode:failure,
      provider:result?.provider,model:result?.providerModel,usage:{ ...result?.usage },completedAt:clock().toISOString(),updatedAt:clock().toISOString() });
  });
}
