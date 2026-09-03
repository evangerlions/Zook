import { ApplicationError } from "../shared/errors.ts";
import type { HttpRequest, HttpResponse } from "../shared/types.ts";
import { getHeader } from "../shared/utils.ts";
import { PublicContractValidator } from "../generated/openapi/public-contract-validator.ts";
import type { BackendRouteContext } from "./backend-route-context.ts";


export async function tryHandleAdminAppSettingsRoutes(
  this: BackendRouteContext,
  request: HttpRequest,
): Promise<HttpResponse<unknown> | undefined> {
  const adminAiRoutingMatch = request.path.match(/^\/api\/v1\/admin\/apps\/([^/]+)\/ai-routing$/);
  if (request.method === "GET" && adminAiRoutingMatch) return await handleAdminGetAiRouting.call(this, request, decodeURIComponent(adminAiRoutingMatch[1] as string));
  if (request.method === "PUT" && adminAiRoutingMatch) return await handleAdminUpdateAiRouting.call(this, request, decodeURIComponent(adminAiRoutingMatch[1] as string));
  const adminAiRoutingRevisionMatch = request.path.match(/^\/api\/v1\/admin\/apps\/([^/]+)\/ai-routing\/revisions\/(\d+)$/);
  if (request.method === "GET" && adminAiRoutingRevisionMatch) return await handleAdminGetAiRoutingRevision.call(this, request, decodeURIComponent(adminAiRoutingRevisionMatch[1] as string), Number(adminAiRoutingRevisionMatch[2]));
  const adminAiRoutingRestoreMatch = request.path.match(/^\/api\/v1\/admin\/apps\/([^/]+)\/ai-routing\/revisions\/(\d+)\/restore$/);
  if (request.method === "POST" && adminAiRoutingRestoreMatch) return await handleAdminRestoreAiRoutingRevision.call(this, request, decodeURIComponent(adminAiRoutingRestoreMatch[1] as string), Number(adminAiRoutingRestoreMatch[2]));
  const adminI18nSettingsMatch = request.path.match(/^\/api\/v1\/admin\/apps\/([^/]+)\/i18n-settings$/);
  if (request.method === "GET" && adminI18nSettingsMatch) return await handleAdminGetI18nSettings.call(this, request, decodeURIComponent(adminI18nSettingsMatch[1] as string));
  if (request.method === "PUT" && adminI18nSettingsMatch) return await handleAdminUpdateI18nSettings.call(this, request, decodeURIComponent(adminI18nSettingsMatch[1] as string));
  const adminI18nRevisionMatch = request.path.match(/^\/api\/v1\/admin\/apps\/([^/]+)\/i18n-settings\/revisions\/(\d+)$/);
  if (request.method === "GET" && adminI18nRevisionMatch) return await handleAdminGetI18nSettingsRevision.call(this, request, decodeURIComponent(adminI18nRevisionMatch[1] as string), Number(adminI18nRevisionMatch[2]));
  const adminI18nRestoreMatch = request.path.match(/^\/api\/v1\/admin\/apps\/([^/]+)\/i18n-settings\/revisions\/(\d+)\/restore$/);
  if (request.method === "POST" && adminI18nRestoreMatch) return await handleAdminRestoreI18nSettingsRevision.call(this, request, decodeURIComponent(adminI18nRestoreMatch[1] as string), Number(adminI18nRestoreMatch[2]));
  const adminConfigMatch = request.path.match(/^\/api\/v1\/admin\/apps\/([^/]+)\/config$/);
  if (request.method === "GET" && adminConfigMatch) return await handleAdminGetConfig.call(this, request, decodeURIComponent(adminConfigMatch[1] as string));
  if (request.method === "PUT" && adminConfigMatch) return await handleAdminUpdateConfig.call(this, request, decodeURIComponent(adminConfigMatch[1] as string));
  const adminConfigRevisionMatch = request.path.match(/^\/api\/v1\/admin\/apps\/([^/]+)\/config\/revisions\/(\d+)$/);
  if (request.method === "GET" && adminConfigRevisionMatch) return await handleAdminGetConfigRevision.call(this, request, decodeURIComponent(adminConfigRevisionMatch[1] as string), Number(adminConfigRevisionMatch[2]));
  const adminConfigRestoreMatch = request.path.match(/^\/api\/v1\/admin\/apps\/([^/]+)\/config\/revisions\/(\d+)\/restore$/);
  if (request.method === "POST" && adminConfigRestoreMatch) return await handleAdminRestoreConfigRevision.call(this, request, decodeURIComponent(adminConfigRestoreMatch[1] as string), Number(adminConfigRestoreMatch[2]));
  return undefined;
}

export async function handleAdminGetConfig(this: BackendRouteContext, 
  request: HttpRequest,
  appId: string,
): Promise<HttpResponse<unknown>> {
  const adminUser = this.authenticateAdmin(request);
  const result = await this.adminConsoleService.getConfig(appId);

  await this.auditInterceptor.record({
    appId,
    action: "admin.config.read",
    resourceType: "app_config",
    resourceId: result.configKey,
    payload: {
      adminUser,
    },
  });

  return this.ok(result, request.requestId as string);
}

export async function handleAdminGetAiRouting(this: BackendRouteContext, 
  request: HttpRequest,
  appId: string,
): Promise<HttpResponse<AdminAiRoutingDocument>> {
  const adminUser = this.authenticateAdmin(request);
  const result = await this.adminConsoleService.getAiRouting(appId);

  await this.auditInterceptor.record({
    appId,
    action: "admin.ai_routing.read",
    resourceType: "app_config",
    resourceId: result.configKey,
    payload: { adminUser },
  });

  return this.ok(result, request.requestId as string);
}

export async function handleAdminUpdateAiRouting(this: BackendRouteContext, 
  request: HttpRequest,
  appId: string,
): Promise<HttpResponse<AdminAiRoutingDocument>> {
  const adminUser = this.authenticateAdmin(request);
  if (appId === "lighttick") await this.assertAdminSensitiveOperation(this.requireAdminSession(request), "lighttick.ai-routing.write");
  const body = this.validationPipe.asObject(request.body);
  const rawJson = this.validationPipe.requireString(body, "rawJson");
  const desc = this.validationPipe.optionalString(body, "desc");
  const result = await this.adminConsoleService.updateAiRouting(
    appId,
    rawJson,
    desc,
  );

  await this.auditInterceptor.record({
    appId,
    action: "admin.ai_routing.update",
    resourceType: "app_config",
    resourceId: result.configKey,
    payload: { adminUser },
  });

  return this.ok(result, request.requestId as string);
}

export async function handleAdminGetAiRoutingRevision(this: BackendRouteContext, 
  request: HttpRequest,
  appId: string,
  revision: number,
): Promise<HttpResponse<AdminAiRoutingDocument>> {
  const adminUser = this.authenticateAdmin(request);
  const result = await this.adminConsoleService.getAiRouting(appId, revision);

  await this.auditInterceptor.record({
    appId,
    action: "admin.ai_routing.revision.read",
    resourceType: "app_config",
    resourceId: `${result.configKey}:${revision}`,
    payload: { adminUser, revision },
  });

  return this.ok(result, request.requestId as string);
}

export async function handleAdminRestoreAiRoutingRevision(this: BackendRouteContext, 
  request: HttpRequest,
  appId: string,
  revision: number,
): Promise<HttpResponse<AdminAiRoutingDocument>> {
  const adminUser = this.authenticateAdmin(request);
  if (appId === "lighttick") await this.assertAdminSensitiveOperation(this.requireAdminSession(request), "lighttick.ai-routing.write");
  const body = this.validationPipe.asObject(request.body ?? {});
  const desc = this.validationPipe.optionalString(body, "desc");
  const result = await this.adminConsoleService.restoreAiRouting(
    appId,
    revision,
    desc,
  );

  await this.auditInterceptor.record({
    appId,
    action: "admin.ai_routing.restore",
    resourceType: "app_config",
    resourceId: `${result.configKey}:${revision}`,
    payload: { adminUser, revision },
  });

  return this.ok(result, request.requestId as string);
}

export async function handleAdminGetI18nSettings(this: BackendRouteContext, 
  request: HttpRequest,
  appId: string,
): Promise<HttpResponse<AdminAppI18nDocument>> {
  const adminUser = this.authenticateAdmin(request);
  const result = await this.adminConsoleService.getI18nSettings(appId);

  await this.auditInterceptor.record({
    appId,
    action: "admin.i18n_settings.read",
    resourceType: "app_config",
    resourceId: result.configKey,
    payload: {
      adminUser,
    },
  });

  return this.ok(result, request.requestId as string);
}

export async function handleAdminUpdateI18nSettings(this: BackendRouteContext, 
  request: HttpRequest,
  appId: string,
): Promise<HttpResponse<AdminAppI18nDocument>> {
  const adminUser = this.authenticateAdmin(request);
  const body = this.validationPipe.asObject(request.body);
  const desc = this.validationPipe.optionalString(body, "desc");
  const config = body.config ?? body;
  const result = await this.adminConsoleService.updateI18nSettings(
    appId,
    config,
    desc,
  );

  await this.auditInterceptor.record({
    appId,
    action: "admin.i18n_settings.update",
    resourceType: "app_config",
    resourceId: result.configKey,
    payload: {
      adminUser,
    },
  });

  return this.ok(result, request.requestId as string);
}

export async function handleAdminGetI18nSettingsRevision(this: BackendRouteContext, 
  request: HttpRequest,
  appId: string,
  revision: number,
): Promise<HttpResponse<AdminAppI18nDocument>> {
  const adminUser = this.authenticateAdmin(request);
  const result = await this.adminConsoleService.getI18nSettings(
    appId,
    revision,
  );

  await this.auditInterceptor.record({
    appId,
    action: "admin.i18n_settings.revision.read",
    resourceType: "app_config",
    resourceId: `${result.configKey}:${revision}`,
    payload: {
      adminUser,
      revision,
    },
  });

  return this.ok(result, request.requestId as string);
}

export async function handleAdminRestoreI18nSettingsRevision(this: BackendRouteContext, 
  request: HttpRequest,
  appId: string,
  revision: number,
): Promise<HttpResponse<AdminAppI18nDocument>> {
  const adminUser = this.authenticateAdmin(request);
  const body = this.validationPipe.asObject(request.body ?? {});
  const desc = this.validationPipe.optionalString(body, "desc");
  const result = await this.adminConsoleService.restoreI18nSettings(
    appId,
    revision,
    desc,
  );

  await this.auditInterceptor.record({
    appId,
    action: "admin.i18n_settings.restore",
    resourceType: "app_config",
    resourceId: `${result.configKey}:${revision}`,
    payload: {
      adminUser,
      revision,
    },
  });

  return this.ok(result, request.requestId as string);
}

function authenticateAdminSuperUser(this: BackendRouteContext, request: HttpRequest): string {
  return this.authenticateAdmin(request);
}

export async function handleAdminUpdateConfig(this: BackendRouteContext, 
  request: HttpRequest,
  appId: string,
): Promise<HttpResponse<unknown>> {
  const adminUser = this.authenticateAdmin(request);
  const body = this.validationPipe.asObject(request.body);
  const rawJson = this.validationPipe.requireString(body, "rawJson");
  const desc = this.validationPipe.optionalString(body, "desc");
  const result = await this.adminConsoleService.updateConfig(
    appId,
    rawJson,
    desc,
  );

  await this.auditInterceptor.record({
    appId,
    action: "admin.config.update",
    resourceType: "app_config",
    resourceId: result.configKey,
    payload: {
      adminUser,
    },
  });

  return this.ok(result, request.requestId as string);
}

export async function handleAdminGetConfigRevision(this: BackendRouteContext, 
  request: HttpRequest,
  appId: string,
  revision: number,
): Promise<HttpResponse<unknown>> {
  const adminUser = this.authenticateAdmin(request);
  const result = await this.adminConsoleService.getConfig(appId, revision);

  await this.auditInterceptor.record({
    appId,
    action: "admin.config.revision.read",
    resourceType: "app_config",
    resourceId: `${result.configKey}:${revision}`,
    payload: {
      adminUser,
      revision,
    },
  });

  return this.ok(result, request.requestId as string);
}

export async function handleAdminRestoreConfigRevision(this: BackendRouteContext, 
  request: HttpRequest,
  appId: string,
  revision: number,
): Promise<HttpResponse<unknown>> {
  const adminUser = this.authenticateAdmin(request);
  const body = this.validationPipe.asObject(request.body ?? {});
  const desc = this.validationPipe.optionalString(body, "desc");
  const result = await this.adminConsoleService.restoreConfig(
    appId,
    revision,
    desc,
  );

  await this.auditInterceptor.record({
    appId,
    action: "admin.config.restore",
    resourceType: "app_config",
    resourceId: `${result.configKey}:${revision}`,
    payload: {
      adminUser,
      revision,
    },
  });

  return this.ok(result, request.requestId as string);
}
