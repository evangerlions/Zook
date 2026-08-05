import { ApplicationError } from "../shared/errors.ts";
import type {
  AdminLlmSmokeTestRunRequest,
  HttpRequest,
  HttpResponse,
} from "../shared/types.ts";
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
  const provider = parseLlmMetricsProvider(request.query?.provider);
  const result = await this.adminConsoleService.getLlmMetrics(range, provider);

  await this.auditInterceptor.record({
    appId: "common",
    action: "admin.llm_service.metrics.read",
    resourceType: "app_config",
    resourceId: `common.llm_service:${range}`,
    payload: {
      adminUser,
      range,
      provider,
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
  const provider = parseLlmMetricsProvider(request.query?.provider);
  const result = await this.adminConsoleService.getLlmModelMetrics(
    modelKey,
    range,
    provider,
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
      provider,
    },
  });

  return this.ok(result, request.requestId as string);
}

export async function handleAdminRunLlmSmokeTest(this: BackendRouteContext, 
  request: HttpRequest,
): Promise<HttpResponse<unknown>> {
  const adminUser = this.authenticateAdmin(request);
  const smokeTestRequest = parseLlmSmokeTestRunRequest.call(this, request.body);
  const result = await this.adminConsoleService.runLlmSmokeTest(smokeTestRequest);

  await this.auditInterceptor.record({
    appId: "common",
    action: "admin.llm_service.smoke_test",
    resourceType: "app_config",
    resourceId: "common.llm_service:smoke-test",
    payload: {
      adminUser,
      target: result.target,
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

function parseLlmMetricsProvider(value: string | undefined): string | undefined {
  const provider = value?.trim();
  return provider || undefined;
}

function parseLlmSmokeTestRunRequest(
  this: BackendRouteContext,
  body: unknown,
): AdminLlmSmokeTestRunRequest {
  const input = this.validationPipe.asObject(body ?? {});
  const mode = this.validationPipe.optionalString(input, "mode");
  if (!mode || mode === "matrix") {
    return { mode: "matrix" };
  }

  if (mode === "route") {
    return {
      mode,
      modelKey: this.validationPipe.requireString(input, "modelKey"),
      provider: this.validationPipe.requireString(input, "provider"),
    };
  }

  throw new ApplicationError(
    400,
    "REQ_INVALID_BODY",
    `Unsupported smoke test mode: ${mode}.`,
  );
}
