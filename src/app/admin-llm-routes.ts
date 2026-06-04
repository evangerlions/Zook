import { ApplicationError } from "../shared/errors.ts";
import type { HttpRequest, HttpResponse } from "../shared/types.ts";
import { getHeader } from "../shared/utils.ts";
import { PublicContractValidator } from "../generated/openapi/public-contract-validator.ts";
import type { BackendRouteContext } from "./backend-route-context.ts";


export async function tryHandleAdminLlmRoutes(
  this: BackendRouteContext,
  request: HttpRequest,
): Promise<HttpResponse<unknown> | undefined> {
  if (request.method === "GET" && request.path === "/api/v1/admin/apps/common/llm-service") return await handleAdminGetLlmService.call(this, request);
  if (request.method === "PUT" && request.path === "/api/v1/admin/apps/common/llm-service") return await handleAdminUpdateLlmService.call(this, request);
  const adminLlmRevisionMatch = request.path.match(/^\/api\/v1\/admin\/apps\/common\/llm-service\/revisions\/(\d+)$/);
  if (request.method === "GET" && adminLlmRevisionMatch) return await handleAdminGetLlmServiceRevision.call(this, request, Number(adminLlmRevisionMatch[1]));
  const adminLlmRestoreMatch = request.path.match(/^\/api\/v1\/admin\/apps\/common\/llm-service\/revisions\/(\d+)\/restore$/);
  if (request.method === "POST" && adminLlmRestoreMatch) return await handleAdminRestoreLlmServiceRevision.call(this, request, Number(adminLlmRestoreMatch[1]));
  if (request.method === "GET" && request.path === "/api/v1/admin/apps/common/llm-service/metrics") return await handleAdminGetLlmMetrics.call(this, request);
  if (request.method === "POST" && request.path === "/api/v1/admin/apps/common/llm-service/smoke-test") return await handleAdminRunLlmSmokeTest.call(this, request);
  const adminLlmModelMetricsMatch = request.path.match(/^\/api\/v1\/admin\/apps\/common\/llm-service\/metrics\/models\/([^/]+)$/);
  if (request.method === "GET" && adminLlmModelMetricsMatch) {
    return await handleAdminGetLlmModelMetrics.call(this, request, decodeURIComponent(adminLlmModelMetricsMatch[1] as string));
  }
  return undefined;
}

export async function handleAdminGetLlmService(this: BackendRouteContext, 
  request: HttpRequest,
): Promise<HttpResponse<unknown>> {
  const adminUser = this.authenticateAdmin(request);
  const result = await this.adminConsoleService.getLlmServiceConfig();

  await this.auditInterceptor.record({
    appId: "common",
    action: "admin.llm_service.read",
    resourceType: "app_config",
    resourceId: result.configKey,
    payload: {
      adminUser,
    },
  });

  return this.ok(result, request.requestId as string);
}

export async function handleAdminUpdateLlmService(this: BackendRouteContext, 
  request: HttpRequest,
): Promise<HttpResponse<unknown>> {
  const adminUser = this.authenticateAdmin(request);
  const body = this.validationPipe.asObject(request.body);
  const desc = this.validationPipe.optionalString(body, "desc");
  const result = await this.adminConsoleService.updateLlmServiceConfig(
    body as AdminLlmServiceDocument["config"],
    desc,
  );

  await this.auditInterceptor.record({
    appId: "common",
    action: "admin.llm_service.update",
    resourceType: "app_config",
    resourceId: result.configKey,
    payload: {
      adminUser,
    },
  });

  return this.ok(result, request.requestId as string);
}

export async function handleAdminGetLlmServiceRevision(this: BackendRouteContext, 
  request: HttpRequest,
  revision: number,
): Promise<HttpResponse<unknown>> {
  const adminUser = this.authenticateAdmin(request);
  const result = await this.adminConsoleService.getLlmServiceConfig(revision);

  await this.auditInterceptor.record({
    appId: "common",
    action: "admin.llm_service.revision.read",
    resourceType: "app_config",
    resourceId: `${result.configKey}:${revision}`,
    payload: {
      adminUser,
      revision,
    },
  });

  return this.ok(result, request.requestId as string);
}

export async function handleAdminRestoreLlmServiceRevision(this: BackendRouteContext, 
  request: HttpRequest,
  revision: number,
): Promise<HttpResponse<unknown>> {
  const adminUser = this.authenticateAdmin(request);
  const body = this.validationPipe.asObject(request.body ?? {});
  const desc = this.validationPipe.optionalString(body, "desc");
  const result = await this.adminConsoleService.restoreLlmServiceConfig(
    revision,
    desc,
  );

  await this.auditInterceptor.record({
    appId: "common",
    action: "admin.llm_service.restore",
    resourceType: "app_config",
    resourceId: `${result.configKey}:${revision}`,
    payload: {
      adminUser,
      revision,
    },
  });

  return this.ok(result, request.requestId as string);
}

export async function handleAdminGetLlmMetrics(this: BackendRouteContext, 
  request: HttpRequest,
): Promise<HttpResponse<unknown>> {
  const adminUser = this.authenticateAdmin(request);
  const range = parseLlmMetricsRange.call(this, request.query?.range);
  const result = await this.adminConsoleService.getLlmMetrics(range);

  await this.auditInterceptor.record({
    appId: "common",
    action: "admin.llm_service.metrics.read",
    resourceType: "app_config",
    resourceId: `common.llm_service:${range}`,
    payload: {
      adminUser,
      range,
    },
  });

  return this.ok(result, request.requestId as string);
}

export async function handleAdminGetLlmModelMetrics(this: BackendRouteContext, 
  request: HttpRequest,
  modelKey: string,
): Promise<HttpResponse<unknown>> {
  const adminUser = this.authenticateAdmin(request);
  const range = parseLlmMetricsRange.call(this, request.query?.range);
  const result = await this.adminConsoleService.getLlmModelMetrics(
    modelKey,
    range,
  );

  await this.auditInterceptor.record({
    appId: "common",
    action: "admin.llm_service.model_metrics.read",
    resourceType: "app_config",
    resourceId: `common.llm_service:${modelKey}:${range}`,
    payload: {
      adminUser,
      modelKey,
      range,
    },
  });

  return this.ok(result, request.requestId as string);
}

export async function handleAdminRunLlmSmokeTest(this: BackendRouteContext, 
  request: HttpRequest,
): Promise<HttpResponse<unknown>> {
  const adminUser = this.authenticateAdmin(request);
  const result = await this.adminConsoleService.runLlmSmokeTest();

  await this.auditInterceptor.record({
    appId: "common",
    action: "admin.llm_service.smoke_test",
    resourceType: "app_config",
    resourceId: "common.llm_service:smoke-test",
    payload: {
      adminUser,
      summary: result.summary,
    },
  });

  return this.ok(result, request.requestId as string);
}

function parseLlmMetricsRange(this: BackendRouteContext, value: string | undefined): LlmMetricsRange {
  if (!value) {
    return "24h";
  }

  if (value === "24h" || value === "7d" || value === "30d") {
    return value;
  }

  throw new ApplicationError(
    400,
    "REQ_INVALID_QUERY",
    `Unsupported range: ${value}.`,
  );
}
