import { ApplicationError } from "../shared/errors.ts";
import type { HttpRequest, HttpResponse } from "../shared/types.ts";
import { getHeader } from "../shared/utils.ts";
import { PublicContractValidator } from "../generated/openapi/public-contract-validator.ts";
import { GETUI_GY_CREDENTIAL_READ_OPERATION } from "../services/common-getui-gy-config.service.ts";
import type { BackendRouteContext } from "./backend-route-context.ts";

import type { GetuiGySensitiveCredentialField } from "../shared/types.ts";

export async function tryHandleAdminAuthGetuiRoutes(
  this: BackendRouteContext,
  request: HttpRequest,
): Promise<HttpResponse<unknown> | undefined> {
  if (request.method === "GET" && request.path === "/api/v1/admin/apps/common/auth-rate-limits") return await handleAdminGetAuthRateLimits.call(this, request);
  if (request.method === "PUT" && request.path === "/api/v1/admin/apps/common/auth-rate-limits") return await handleAdminUpdateAuthRateLimits.call(this, request);
  const adminAuthRateLimitRevisionMatch = request.path.match(/^\/api\/v1\/admin\/apps\/common\/auth-rate-limits\/revisions\/(\d+)$/);
  if (request.method === "GET" && adminAuthRateLimitRevisionMatch) return await handleAdminGetAuthRateLimitsRevision.call(this, request, Number(adminAuthRateLimitRevisionMatch[1]));
  const adminAuthRateLimitRestoreMatch = request.path.match(/^\/api\/v1\/admin\/apps\/common\/auth-rate-limits\/revisions\/(\d+)\/restore$/);
  if (request.method === "POST" && adminAuthRateLimitRestoreMatch) return await handleAdminRestoreAuthRateLimitsRevision.call(this, request, Number(adminAuthRateLimitRestoreMatch[1]));
  if (request.method === "GET" && request.path === "/api/v1/admin/apps/common/getui-gy-service") return await handleAdminGetGetuiGyService.call(this, request);
  if (request.method === "PUT" && request.path === "/api/v1/admin/apps/common/getui-gy-service") return await handleAdminUpdateGetuiGyService.call(this, request);
  const adminGetuiGyRevisionMatch = request.path.match(/^\/api\/v1\/admin\/apps\/common\/getui-gy-service\/revisions\/(\d+)$/);
  if (request.method === "GET" && adminGetuiGyRevisionMatch) return await handleAdminGetGetuiGyServiceRevision.call(this, request, Number(adminGetuiGyRevisionMatch[1]));
  const adminGetuiGyRestoreMatch = request.path.match(/^\/api\/v1\/admin\/apps\/common\/getui-gy-service\/revisions\/(\d+)\/restore$/);
  if (request.method === "POST" && adminGetuiGyRestoreMatch) return await handleAdminRestoreGetuiGyServiceRevision.call(this, request, Number(adminGetuiGyRestoreMatch[1]));
  const adminGetuiGyCredentialRevealMatch = request.path.match(/^\/api\/v1\/admin\/apps\/common\/getui-gy-service\/apps\/([^/]+)\/(appKey|appSecret|masterSecret)\/reveal$/);
  if (request.method === "POST" && adminGetuiGyCredentialRevealMatch) {
    return await handleAdminRevealGetuiGyCredentialValue.call(this, request, decodeURIComponent(adminGetuiGyCredentialRevealMatch[1]), adminGetuiGyCredentialRevealMatch[2] as GetuiGySensitiveCredentialField);
  }
  return undefined;
}

export async function handleAdminGetAuthRateLimits(this: BackendRouteContext, 
  request: HttpRequest,
): Promise<HttpResponse<unknown>> {
  const adminUser = this.authenticateAdmin(request);
  const result = await this.adminConsoleService.getAuthRateLimitConfig();

  await this.auditInterceptor.record({
    appId: "common",
    action: "admin.auth_rate_limits.read",
    resourceType: "app_config",
    resourceId: result.configKey,
    payload: {
      adminUser,
    },
  });

  return this.ok(result, request.requestId as string);
}

export async function handleAdminUpdateAuthRateLimits(this: BackendRouteContext, 
  request: HttpRequest,
): Promise<HttpResponse<unknown>> {
  const adminUser = this.authenticateAdmin(request);
  const body = this.validationPipe.asObject(request.body);
  const desc = this.validationPipe.optionalString(body, "desc");
  const result = await this.adminConsoleService.updateAuthRateLimitConfig(
    body as AdminAuthRateLimitDocument["config"],
    desc,
  );

  await this.auditInterceptor.record({
    appId: "common",
    action: "admin.auth_rate_limits.update",
    resourceType: "app_config",
    resourceId: result.configKey,
    payload: {
      adminUser,
    },
  });

  return this.ok(result, request.requestId as string);
}

export async function handleAdminGetAuthRateLimitsRevision(this: BackendRouteContext, 
  request: HttpRequest,
  revision: number,
): Promise<HttpResponse<unknown>> {
  const adminUser = this.authenticateAdmin(request);
  const result =
    await this.adminConsoleService.getAuthRateLimitConfig(revision);

  await this.auditInterceptor.record({
    appId: "common",
    action: "admin.auth_rate_limits.revision.read",
    resourceType: "app_config",
    resourceId: `${result.configKey}:${revision}`,
    payload: {
      adminUser,
      revision,
    },
  });

  return this.ok(result, request.requestId as string);
}

export async function handleAdminRestoreAuthRateLimitsRevision(this: BackendRouteContext, 
  request: HttpRequest,
  revision: number,
): Promise<HttpResponse<unknown>> {
  const adminUser = this.authenticateAdmin(request);
  const body = this.validationPipe.asObject(request.body ?? {});
  const desc = this.validationPipe.optionalString(body, "desc");
  const result = await this.adminConsoleService.restoreAuthRateLimitConfig(
    revision,
    desc,
  );

  await this.auditInterceptor.record({
    appId: "common",
    action: "admin.auth_rate_limits.restore",
    resourceType: "app_config",
    resourceId: `${result.configKey}:${revision}`,
    payload: {
      adminUser,
      revision,
    },
  });

  return this.ok(result, request.requestId as string);
}

export async function handleAdminGetGetuiGyService(this: BackendRouteContext, 
  request: HttpRequest,
): Promise<HttpResponse<unknown>> {
  const adminUser = this.authenticateAdmin(request);
  const result = await this.adminConsoleService.getGetuiGyServiceConfig();

  await this.auditInterceptor.record({
    appId: "common",
    action: "admin.getui_gy_service.read",
    resourceType: "app_config",
    resourceId: result.configKey,
    payload: {
      adminUser,
    },
  });

  return this.ok(result, request.requestId as string);
}

export async function handleAdminUpdateGetuiGyService(this: BackendRouteContext, 
  request: HttpRequest,
): Promise<HttpResponse<unknown>> {
  const adminUser = this.authenticateAdmin(request);
  const body = this.validationPipe.asObject(request.body);
  const desc = this.validationPipe.optionalString(body, "desc");
  const result = await this.adminConsoleService.updateGetuiGyServiceConfig(
    body,
    desc,
  );

  await this.auditInterceptor.record({
    appId: "common",
    action: "admin.getui_gy_service.update",
    resourceType: "app_config",
    resourceId: result.configKey,
    payload: {
      adminUser,
    },
  });

  return this.ok(result, request.requestId as string);
}

export async function handleAdminGetGetuiGyServiceRevision(this: BackendRouteContext, 
  request: HttpRequest,
  revision: number,
): Promise<HttpResponse<unknown>> {
  const adminUser = this.authenticateAdmin(request);
  const result =
    await this.adminConsoleService.getGetuiGyServiceConfig(revision);

  await this.auditInterceptor.record({
    appId: "common",
    action: "admin.getui_gy_service.revision.read",
    resourceType: "app_config",
    resourceId: `${result.configKey}:${revision}`,
    payload: {
      adminUser,
      revision,
    },
  });

  return this.ok(result, request.requestId as string);
}

export async function handleAdminRestoreGetuiGyServiceRevision(this: BackendRouteContext, 
  request: HttpRequest,
  revision: number,
): Promise<HttpResponse<unknown>> {
  const adminUser = this.authenticateAdmin(request);
  const body = this.validationPipe.asObject(request.body ?? {});
  const desc = this.validationPipe.optionalString(body, "desc");
  const result = await this.adminConsoleService.restoreGetuiGyServiceConfig(
    revision,
    desc,
  );

  await this.auditInterceptor.record({
    appId: "common",
    action: "admin.getui_gy_service.restore",
    resourceType: "app_config",
    resourceId: `${result.configKey}:${revision}`,
    payload: {
      adminUser,
      revision,
    },
  });

  return this.ok(result, request.requestId as string);
}

export async function handleAdminRevealGetuiGyCredentialValue(this: BackendRouteContext, 
  request: HttpRequest,
  zookAppId: string,
  field: GetuiGySensitiveCredentialField,
): Promise<HttpResponse<AdminGetuiGyCredentialRevealDocument>> {
  const session = this.requireAdminSession(request);
  await this.adminSensitiveOperationService.assertGranted(
    session,
    GETUI_GY_CREDENTIAL_READ_OPERATION,
  );
  const result = await this.adminConsoleService.revealGetuiGyCredentialValue(
    zookAppId,
    field,
  );

  await this.auditInterceptor.record({
    appId: "common",
    action: "admin.getui_gy_service.credential.reveal",
    resourceType: "app_config",
    resourceId: `${result.configKey}:${zookAppId}:${field}`,
    payload: {
      adminUser: session.username,
      zookAppId,
      field,
    },
  });

  return this.ok(result, request.requestId as string);
}
