import type { HttpRequest, HttpResponse } from "../shared/types.ts";
import type { BackendRouteContext } from "./backend-route-context.ts";

export async function tryHandleAdminAiNovelUsageRoutes(
  this: BackendRouteContext,
  request: HttpRequest,
): Promise<HttpResponse<unknown> | undefined> {
  if (
    request.method !== "GET" ||
    request.path !== "/api/v1/admin/apps/ai_novel/usage"
  )
    return undefined;
  const session = this.requireAdminSession(request);
  const result = await this.aiNovelUsageAdminService.report(
    request.query ?? {},
  );
  await this.recordAdminBillingReadAudit({
    adminUser: session.username,
    appId: "ai_novel",
    action: "admin.ai_novel.usage.read",
    resourceId: "usage",
    requestId: request.requestId,
    filterNames: Object.keys(request.query ?? {}).sort(),
  });
  return this.ok(result, request.requestId as string, {
    "Cache-Control": "no-store",
  });
}
