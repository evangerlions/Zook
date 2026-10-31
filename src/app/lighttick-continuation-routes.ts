import { Ajv2020 } from 'ajv/dist/2020.js';
import addFormats,{ type FormatsPlugin } from 'ajv-formats';
import { LightTickConditionCommandSchema } from '../generated/openapi/public-contracts.generated.ts';
import { ApplicationError } from '../shared/errors.ts';
import type { HttpRequest } from '../shared/types.ts';
import type { LightTickOwner,LightTickGoalRow } from '../modules/lighttick/lighttick.types.ts';
import type { LightTickRepository } from '../modules/lighttick/lighttick.repository.ts';
import { GoalConditionsService } from '../modules/lighttick/goal-context/goal-conditions.service.ts';
import { manualTaskData } from '../modules/lighttick/manual/manual-planning.service.ts';
import { reflectionData } from '../modules/lighttick/lighttick-reflection.service.ts';
const ajv=new Ajv2020({ strict: false,allErrors: true });
(addFormats as unknown as FormatsPlugin)(ajv);
const validate=ajv.compile(LightTickConditionCommandSchema);
export const continuationGoalData=(g: LightTickGoalRow) => ({ id: g.id,title: g.title,status: g.status,version: g.version,completion_criteria: typeof g.constraints.completion_criteria==='string'? g.constraints.completion_criteria:'',closure_outcome: g.constraints.closure_outcome??null });
export async function handleContinuationRequest(repository: LightTickRepository,owner: LightTickOwner,request: HttpRequest,assertActive: () => Promise<void>) {
  const match=/^\/api\/v1\/lighttick\/goals\/([a-zA-Z0-9_-]{1,128})\/(continuation|conditions)$/.exec(request.path);
  if(!match)
    return undefined;
  const service=new GoalConditionsService(repository,() => new Date(),assertActive);
  if(request.method==='GET'&&match[2]==='continuation') {
    const start=request.query?.period_start,end=request.query?.period_end;
    if(typeof start!=='string'||typeof end!=='string')
      throw new ApplicationError(400,'REQ_FIELD_REQUIRED','An explicit review window is required.');
    const c=await service.context(owner,match[1],start,end);
    return {
      continuation_enabled: process.env.LIGHTTICK_NATIVE_CONTINUATION_ENABLED!=='0',goal: continuationGoalData(c.goal),period_start: start,period_end: end,tasks: c.tasks.map(t => ({ ...manualTaskData(t,c.timezone),lineage_id: t.lineageId??t.id,actual_minutes: t.actualMinutes??null })),reflections: c.reflections.map(reflectionData),conditions: c.conditions,daily_limits: c.daily_limits,
      plans: c.plans.map(p => { const d=p.proposal.draft as any; return { id: p.id,title: d?.title??c.goal.title,status: p.status,period_start: p.periodStart.slice(0,10),period_end: p.periodEnd.slice(0,10),source_reflection_id: d?.source_reflection_id??null,source_reflection_version: d?.source_reflection_version??null }; })
    };
  }
  if(request.method==='POST'&&match[2]==='conditions') {
    const key=request.headers['idempotency-key']??request.headers['Idempotency-Key']??'';
    if(process.env.LIGHTTICK_NATIVE_CONTINUATION_ENABLED==='0'&&!await repository.getOperation(owner,key))
      throw new ApplicationError(503,'LIGHTTICK_APP_DISABLED','New continuation writes are unavailable; saved history and accepted requests remain available.');
    if(!validate(request.body))
      throw new ApplicationError(422,'LIGHTTICK_PLAN_CONSTRAINT_FAILED','Review the condition, date window, and versions.');
    const result=await service.confirm(owner,match[1],key,request.body as unknown as Record<string,unknown>);
    return { goal: continuationGoalData(result.goal),condition: result.condition };
  }
  throw new ApplicationError(404,'LIGHTTICK_RESOURCE_NOT_FOUND','Continuation route was not found.');
}
