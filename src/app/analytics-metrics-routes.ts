import { ApplicationError } from "../shared/errors.ts";
import type { HttpRequest, HttpResponse } from "../shared/types.ts";
import { getHeader, maskSensitiveString } from "../shared/utils.ts";
import { PublicContractValidator } from "../generated/openapi/public-contract-validator.ts";
import type { BackendRouteContext } from "./backend-route-context.ts";

export async function handleAnalyticsBatch(this: BackendRouteContext, 
  request: HttpRequest,
): Promise<HttpResponse<unknown>> {
  const auth = await this.authenticate(request);
  const body = this.validationPipe.asObject(request.body);
  const validated = this.requireValidPublicContract(
    PublicContractValidator.validateAnalyticsBatch(body),
    request,
  );
  const appId = this.validationPipe.requireString(
    validated as Record<string, unknown>,
    "appId",
  );
  this.appAccessGuard.assertScope(appId, auth.appId);
  const result = await this.analyticsService.recordBatch({
    appId: auth.appId,
    userId: auth.userId,
    events: validated.events,
  });

  return this.ok(result, request.requestId as string);
}

export async function handleMetricsOverview(this: BackendRouteContext, 
  request: HttpRequest,
): Promise<HttpResponse<unknown>> {
  const auth = await this.authenticate(request);
  await this.rbacGuard.assertPermission(
    auth.appId,
    auth.userId,
    "metrics:read",
  );

  const requestedAppId = request.query?.appId ?? auth.appId;
  this.appAccessGuard.assertScope(requestedAppId, auth.appId);

  const dateFrom = this.validationPipe.requireQueryString(
    request.query,
    "dateFrom",
  );
  const dateTo = this.validationPipe.requireQueryString(
    request.query,
    "dateTo",
  );
  const result = await this.analyticsService.getOverview(
    auth.appId,
    dateFrom,
    dateTo,
  );

  return this.ok(result, request.requestId as string);
}

export async function handleMetricsPages(this: BackendRouteContext, 
  request: HttpRequest,
): Promise<HttpResponse<unknown>> {
  const auth = await this.authenticate(request);
  await this.rbacGuard.assertPermission(
    auth.appId,
    auth.userId,
    "metrics:read",
  );

  const requestedAppId = request.query?.appId ?? auth.appId;
  this.appAccessGuard.assertScope(requestedAppId, auth.appId);

  const dateFrom = this.validationPipe.requireQueryString(
    request.query,
    "dateFrom",
  );
  const dateTo = this.validationPipe.requireQueryString(
    request.query,
    "dateTo",
  );
  const platform = request.query?.platform as Platform | undefined;
  const result = await this.analyticsService.getPageMetrics(
    auth.appId,
    dateFrom,
    dateTo,
    platform,
  );

  return this.ok(result, request.requestId as string);
}
