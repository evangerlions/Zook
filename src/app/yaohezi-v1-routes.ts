import type { BackendRouteContext } from "./backend-route-context.ts";
import type { HttpRequest, HttpResponse } from "../shared/types.ts";
import type { YaoheziMeData } from "../generated/openapi/public-contracts.generated.ts";
import { ApplicationError } from "../shared/errors.ts";
import { YAOHEZI_APP_ID } from "../modules/yaohezi/yaohezi-seed.ts";

export async function tryHandleYaoheziV1Routes(context: BackendRouteContext, enabled: boolean,
  request: HttpRequest): Promise<HttpResponse<unknown> | undefined> {
  if (request.path !== "/api/v1/yaohezi" && !request.path.startsWith("/api/v1/yaohezi/")) return undefined;
  if (!enabled) throw new ApplicationError(404, "YAOHEZI_DISABLED", "Yaohezi is not enabled.");
  const auth = await context.authenticateProductRequest(request, YAOHEZI_APP_ID);
  if (request.method === "GET" && request.path === "/api/v1/yaohezi/me") {
    const data: YaoheziMeData = { appId: YAOHEZI_APP_ID, userId: auth.userId, healthAccessEstablished: false,
      capabilities: { cloudSync: false, familySharing: false, reportAI: false, subscriptionSales: false } };
    return context.ok(data, request.requestId as string);
  }
  throw new ApplicationError(404, "YAOHEZI_ROUTE_NOT_FOUND", "Unknown Yaohezi route.");
}
