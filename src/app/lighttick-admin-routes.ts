import { LIGHTTICK_AI_SCENES } from "../modules/lighttick/ai/lighttick-ai-scenes.ts";
import type { LightTickRuntime } from "../modules/lighttick/lighttick-runtime.ts";
import type { HttpRequest, HttpResponse } from "../shared/types.ts";
import type { BackendRouteContext } from "./backend-route-context.ts";

export async function tryHandleLightTickAdminRoutes(context: BackendRouteContext, enabled: boolean,
  runtime: LightTickRuntime | undefined, request: HttpRequest): Promise<HttpResponse<unknown> | undefined> {
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
