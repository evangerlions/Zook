import {LearningMigrationService,type LearningMigrationAction} from "../modules/lighttick/learning/learning-migration.service.ts";
import {object,keys,text,integer,identity} from "../modules/lighttick/learning/native-learning.validation.ts";
import {ApplicationError} from "../shared/errors.ts";
import { LIGHTTICK_AI_SCENES } from "../modules/lighttick/ai/lighttick-ai-scenes.ts";
import type { LightTickRuntime } from "../modules/lighttick/lighttick-runtime.ts";
import type { HttpRequest, HttpResponse } from "../shared/types.ts";
import type { BackendRouteContext } from "./backend-route-context.ts";

export async function tryHandleLightTickAdminRoutes(context: BackendRouteContext, enabled: boolean,
  runtime: LightTickRuntime | undefined, request: HttpRequest): Promise<HttpResponse<unknown> | undefined> {
  const migration=/^\/api\/v1\/admin\/apps\/lighttick\/learning-migrations\/([a-zA-Z0-9_-]+)\/(preflight|freeze|import|verify|activate|abort)$/.exec(request.path);
  if(migration&&request.method==='POST'){
    const session=context.requireAdminSession(request);if(!enabled||!runtime)throw new ApplicationError(503,'LIGHTTICK_APP_DISABLED','LightTick is not enabled.');
    const owner={appId:'lighttick' as const,userId:identity(migration[1])},body=object(request.body);keys(body,['bundle','expected_digest','base_revision']);const digest=text(body.expected_digest,64,true),action=migration[2];
    await context.assertActiveProductOwner(owner.appId,owner.userId);const service=new LearningMigrationService(runtime.nativeLearning);
    if(action==='preflight'){const result=await service.preflight(owner,body.bundle,digest);await context.recordAdminReadAudit(session.adminUser,'lighttick.learning.migration.preflight','learning_authority',owner.userId,request.requestId,'metadata_only');return context.ok(result,request.requestId??'',{'Cache-Control':'no-store'});}
    await context.assertAdminSensitiveOperation(session,'lighttick.learning.migrate');
    const result=await service.command(owner,action as LearningMigrationAction,body.bundle,digest,integer(body.base_revision,0,2147483646),request.headers['idempotency-key']??'',async()=>{await context.assertActiveProductOwner(owner.appId,owner.userId);await context.assertAdminSensitiveOperation(session,'lighttick.learning.migrate');});
    await context.recordAdminMutationAudit({appId:'lighttick',actorUserId:session.adminUser,action:'lighttick.learning.migration.'+action,resourceType:'learning_authority',resourceId:owner.userId,payload:{manifest_hash:digest,result,requestId:request.requestId}});
    return context.ok(result,request.requestId??'',{'Cache-Control':'no-store'});
  }
  if (request.method !== "GET" || request.path !== "/api/v1/admin/apps/lighttick/operations") return undefined;
  const session = context.requireAdminSession(request);
  await context.recordAdminReadAudit(session.adminUser, "lighttick.operations.read", "app_operations", "lighttick", request.requestId);
  const metrics = runtime ? await runtime.repository.getAdminOperationalSummary() : {};
  const maxRunCost = Math.max(...Object.values(LIGHTTICK_AI_SCENES).map(scene => scene.maxEstimatedCostUsd));
  metrics.ai_estimated_cost_upper_bound_usd = Number(((metrics.ai_runs ?? 0) * maxRunCost).toFixed(4));
  return context.ok({ app_id: "lighttick", enabled, admin_user: session.adminUser,
    feature_flags: { ai_planning: false, offline_sync: true, notifications: true },
    notification_defaults: { daily_reminder: true, review_reminders: true, quiet_hours_supported: true },
    scenes: Object.values(LIGHTTICK_AI_SCENES).map(scene => ({ key: scene.key, kind: scene.kind,
      model_alias: scene.modelAlias, prompt_version: scene.promptVersion, schema_version: scene.schemaVersion,
      timeout_ms: scene.timeoutMs, max_context_tokens: scene.maxContextTokens, max_output_tokens: scene.maxOutputTokens,
      max_estimated_cost_usd: scene.maxEstimatedCostUsd, fallback: scene.fallback })), metrics,
    privacy: { aggregates_only: true, private_text_visible: false },
  }, request.requestId as string);
}
