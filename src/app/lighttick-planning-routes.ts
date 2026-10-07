import type { BackendRouteContext } from "./backend-route-context.ts";
import type { HttpRequest, HttpResponse } from "../shared/types.ts";
import type { LightTickRuntime } from "../modules/lighttick/lighttick-runtime.ts";
import { LightTickPlanningService } from "../modules/lighttick/planning/planning.service.ts";
import { planningError, sessionData, text } from "../modules/lighttick/planning/planning-context.ts";
import { getHeader } from "../shared/utils.ts";

export async function tryHandleLightTickPlanningRoutes(context: BackendRouteContext, enabled: boolean,
  runtime: LightTickRuntime | undefined, request: HttpRequest): Promise<HttpResponse<unknown> | undefined> {
  const match = request.path.match(/^\/api\/v1\/lighttick\/planning-sessions(?:\/([^/]+)(?:\/(messages|context|drafts|confirm))?)?$/);
  if (!match) return undefined;
  if (!enabled || !runtime || !runtime.planningEnabled) planningError(503,"LIGHTTICK_APP_DISABLED","Conversational planning is not enabled.");
  const auth = await context.authenticateProductRequest(request,"lighttick");
  if (runtime!.guestIdentity && await runtime!.guestIdentity.getActive(auth.userId)) planningError(403,"APP_SCOPE_FORBIDDEN","Registered LightTick membership is required.");
  const owner = {appId:"lighttick" as const,userId:auth.userId};
  const service = new LightTickPlanningService(runtime!.repository);
  if (request.method === "GET" && match[1] && !match[2]) return context.ok(sessionData(await service.get(owner,match[1])),request.requestId!);
  const override = getHeader(request.headers,"x-http-method-override");
  if (override !== undefined) {
    if (request.method !== "POST" || match[2] !== "context" || override.toUpperCase() !== "PATCH")
      planningError(400,"REQ_FIELD_INVALID","Method override is only supported for context PATCH.");
    request = {...request, method:"PATCH"};
  }
  const action = !match[1] ? "create" : match[2];
  if (!action || request.method !== (action === "context" ? "PATCH" : "POST")) planningError(405,"REQ_METHOD_NOT_ALLOWED","Method is not supported.");
  if (!request.body || typeof request.body !== "object" || Array.isArray(request.body)) planningError(400,"REQ_INVALID_BODY","JSON body is required.");
  const body = request.body as Record<string,unknown>;
  const allowed: Record<string,string[]> = {create:["goal_id"],context:["base_version","fields"],messages:["base_version","message"],
    drafts:["base_version","context_revision","instruction","deep_planning"],confirm:["base_version","context_revision","draft_plan_id","plan_version"]};
  if (Object.keys(body).some(k=>!allowed[action!].includes(k))) planningError(400,"REQ_FIELD_INVALID","Unknown planning request field.");
  if (body.deep_planning !== undefined && typeof body.deep_planning !== "boolean") planningError(400,"REQ_FIELD_INVALID","deep_planning must be boolean.");
  if (["messages","drafts"].includes(action!) && !runtime!.jobs) planningError(503,"LIGHTTICK_AI_UNAVAILABLE","Planning worker is not available.");
  const result = await service.command(owner,text(getHeader(request.headers,"idempotency-key"),128),action!,match[1],body);
  if (result.run) await runtime!.jobs!.enqueueAiRun(owner,result.run.id,result.run.inputContext.planning_action === "messages" ? "planning_clarify":"week_plan");
  const response = context.ok({session:sessionData(result.session),run:result.run ? {id:result.run.id,status:result.run.status,scene:result.run.sceneKey,prompt_version:result.run.promptVersion}:null},request.requestId!);
  response.statusCode=result.run?202:action==="create"?201:200;
  response.body.code=result.run?"ACCEPTED":action==="create"?"CREATED":"OK";
  return response;
}
