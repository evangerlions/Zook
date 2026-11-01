import type { BackendRouteContext } from "./backend-route-context.ts";
import type { HttpRequest, HttpResponse } from "../shared/types.ts";
import type { YaoheziMeData } from "../generated/openapi/public-contracts.generated.ts";
import { getHeader } from "../shared/utils.ts";
import { ApplicationError } from "../shared/errors.ts";
import { YAOHEZI_APP_ID } from "../modules/yaohezi/yaohezi-seed.ts";

export async function tryHandleYaoheziV1Routes(context: BackendRouteContext, enabled: boolean,
  request: HttpRequest, healthEnabled = false): Promise<HttpResponse<unknown> | undefined> {
  if (request.path !== "/api/v1/yaohezi" && !request.path.startsWith("/api/v1/yaohezi/")) return undefined;
  if (!enabled) throw new ApplicationError(404, "YAOHEZI_DISABLED", "Yaohezi is not enabled.");
  if (request.path.startsWith("/api/v1/yaohezi/health/") && !healthEnabled) throw new ApplicationError(404, "YAOHEZI_DISABLED", "Health devices are not enabled.");
  const auth = await context.authenticateProductRequest(request, YAOHEZI_APP_ID);
  if (request.method === "GET" && request.path === "/api/v1/yaohezi/me") {
    const data: YaoheziMeData = { appId: YAOHEZI_APP_ID, userId: auth.userId, healthAccessEstablished: false,
      capabilities: { cloudSync: false, familySharing: false, reportAI: false, subscriptionSales: false } };
    return context.ok(data, request.requestId as string);
  }
  if (request.method === "POST" && request.path.startsWith("/api/v1/yaohezi/health/")) {
    const store = context.getYaoheziHealthStore();
    if (!store) throw new ApplicationError(503, "YAOHEZI_HEALTH_STORAGE_REQUIRED", "Durable health trust storage is required.");
    const action = request.path.slice("/api/v1/yaohezi/health/".length);
    const data = await store.handle(action, { appId: "yaohezi", userId: auth.userId }, request.body,
      getHeader(request.headers, "x-yaohezi-health-session"));
    return context.ok(data, request.requestId as string, { "cache-control":"no-store", "pragma":"no-cache" });
  }
  throw new ApplicationError(404, "YAOHEZI_ROUTE_NOT_FOUND", "Unknown Yaohezi route.");
}

/** Trust repositories own their account/subject transaction; avoid the legacy application-wide lock. */
export function ownsYaoheziHealthTransaction(request:HttpRequest,enabled:boolean):boolean {
  return enabled && request.method==="POST" && request.path.startsWith("/api/v1/yaohezi/health/");
}
