import { ApplicationError } from "../shared/errors.ts";
import type { HttpRequest, HttpResponse } from "../shared/types.ts";
import { getHeader } from "../shared/utils.ts";
import { PublicContractValidator } from "../generated/openapi/public-contract-validator.ts";
import { CONTENT_SAFETY_MANAGE_OPERATION } from "../services/common-content-safety-config.service.ts";
import { PASSWORD_VALUE_READ_OPERATION } from "../services/common-password-config.service.ts";
import { SMS_VERIFICATION_REVEAL_OPERATION } from "../services/sms-verification-record.service.ts";
import type { BackendRouteContext } from "./backend-route-context.ts";


export async function tryHandleAdminSecurityRoutes(
  this: BackendRouteContext,
  request: HttpRequest,
): Promise<HttpResponse<unknown> | undefined> {
  if (request.method === "GET" && request.path === "/api/v1/admin/apps/common/passwords") return await handleAdminGetPasswords.call(this, request);
  if (request.method === "PUT" && request.path === "/api/v1/admin/apps/common/passwords") return await handleAdminUpdatePasswords.call(this, request);
  if (request.method === "PUT" && request.path === "/api/v1/admin/apps/common/passwords/item") return await handleAdminUpsertPasswordItem.call(this, request);
  const adminPasswordRevealMatch = request.path.match(/^\/api\/v1\/admin\/apps\/common\/passwords\/([^/]+)\/reveal$/);
  if (request.method === "POST" && adminPasswordRevealMatch) return await handleAdminRevealPasswordValue.call(this, request, decodeURIComponent(adminPasswordRevealMatch[1]));
  const adminPasswordDeleteMatch = request.path.match(/^\/api\/v1\/admin\/apps\/common\/passwords\/([^/]+)$/);
  if (request.method === "DELETE" && adminPasswordDeleteMatch) return await handleAdminDeletePasswordItem.call(this, request, decodeURIComponent(adminPasswordDeleteMatch[1]));
  if (request.method === "GET" && request.path === "/api/v1/admin/apps/common/sms-verifications") return await handleAdminListSmsVerificationRecords.call(this, request);
  const adminSmsVerificationRevealMatch = request.path.match(/^\/api\/v1\/admin\/apps\/common\/sms-verifications\/([^/]+)\/reveal$/);
  if (request.method === "POST" && adminSmsVerificationRevealMatch) return await handleAdminRevealSmsVerificationRecord.call(this, request, decodeURIComponent(adminSmsVerificationRevealMatch[1]));
  if (request.method === "GET" && request.path === "/api/v1/admin/apps/common/content-safety") return await handleAdminGetContentSafety.call(this, request);
  if (request.method === "PUT" && request.path === "/api/v1/admin/apps/common/content-safety") return await handleAdminUpdateContentSafety.call(this, request);
  if (request.method === "POST" && request.path === "/api/v1/admin/apps/common/content-safety/test") return await handleAdminTestContentSafety.call(this, request);
  if (request.method === "GET" && request.path === "/api/v1/admin/apps/common/content-safety/block-records") return await handleAdminListContentSafetyBlockRecords.call(this, request);
  if (request.method === "GET" && request.path === "/api/v1/admin/apps/common/content-safety/stats") return await handleAdminGetContentSafetyStats.call(this, request);
  const adminContentSafetyRevisionMatch = request.path.match(/^\/api\/v1\/admin\/apps\/common\/content-safety\/revisions\/(\d+)$/);
  if (request.method === "GET" && adminContentSafetyRevisionMatch) return await handleAdminGetContentSafetyRevision.call(this, request, Number(adminContentSafetyRevisionMatch[1]));
  const adminContentSafetyRestoreMatch = request.path.match(/^\/api\/v1\/admin\/apps\/common\/content-safety\/revisions\/(\d+)\/restore$/);
  if (request.method === "POST" && adminContentSafetyRestoreMatch) return await handleAdminRestoreContentSafetyRevision.call(this, request, Number(adminContentSafetyRestoreMatch[1]));
  return undefined;
}

export async function handleAdminGetPasswords(this: BackendRouteContext, 
  request: HttpRequest,
): Promise<HttpResponse<unknown>> {
  const adminUser = this.authenticateAdmin(request);
  const result = await this.adminConsoleService.getPasswordConfig();

  await this.auditInterceptor.record({
    appId: "common",
    action: "admin.password.read",
    resourceType: "app_config",
    resourceId: result.configKey,
    payload: {
      adminUser,
    },
  });

  return this.ok(result, request.requestId as string);
}

export async function handleAdminRevealPasswordValue(this: BackendRouteContext, 
  request: HttpRequest,
  key: string,
): Promise<HttpResponse<AdminPasswordRevealDocument>> {
  const session = this.requireAdminSession(request);
  await this.adminSensitiveOperationService.assertGranted(
    session,
    PASSWORD_VALUE_READ_OPERATION,
  );
  const result = await this.adminConsoleService.revealPasswordValue(key);

  await this.auditInterceptor.record({
    appId: "common",
    action: "admin.password.reveal",
    resourceType: "password_item",
    resourceId: key,
    payload: {
      adminUser: session.username,
    },
  });

  return this.ok(result, request.requestId as string);
}

export async function handleAdminListSmsVerificationRecords(this: BackendRouteContext, 
  request: HttpRequest,
): Promise<HttpResponse<AdminSmsVerificationListDocument>> {
  const adminUser = this.authenticateAdmin(request);
  const filterAppId =
    typeof request.query?.appId === "string"
      ? request.query.appId.trim()
      : "";
  const result = await this.adminConsoleService.listSmsVerificationRecords(
    filterAppId || undefined,
  );

  await this.auditInterceptor.record({
    appId: "common",
    action: "admin.sms_verification.read",
    resourceType: "sms_verification",
    resourceId: filterAppId || "all",
    payload: {
      adminUser,
      filterAppId: filterAppId || undefined,
    },
  });

  return this.ok(result, request.requestId as string);
}

export async function handleAdminRevealSmsVerificationRecord(this: BackendRouteContext, 
  request: HttpRequest,
  recordId: string,
): Promise<HttpResponse<AdminSmsVerificationRevealDocument>> {
  const session = this.requireAdminSession(request);
  await this.adminSensitiveOperationService.assertGranted(
    session,
    SMS_VERIFICATION_REVEAL_OPERATION,
  );
  const result =
    await this.adminConsoleService.revealSmsVerificationRecord(recordId);

  await this.auditInterceptor.record({
    appId: result.item.appId,
    action: "admin.sms_verification.reveal",
    resourceType: "sms_verification",
    resourceId: recordId,
    payload: {
      adminUser: session.username,
      appId: result.item.appId,
    },
  });

  return this.ok(result, request.requestId as string);
}

export async function handleAdminUpdatePasswords(this: BackendRouteContext, 
  request: HttpRequest,
): Promise<HttpResponse<unknown>> {
  const adminUser = this.authenticateAdmin(request);
  const body = this.validationPipe.asObject(request.body);
  const result = await this.adminConsoleService.updatePasswordConfig(body);

  await this.auditInterceptor.record({
    appId: "common",
    action: "admin.password.update",
    resourceType: "app_config",
    resourceId: result.configKey,
    payload: {
      adminUser,
    },
  });

  return this.ok(result, request.requestId as string);
}

export async function handleAdminGetContentSafety(this: BackendRouteContext, 
  request: HttpRequest,
): Promise<HttpResponse<AdminContentSafetyDocument>> {
  const session = this.requireAdminSession(request);
  await this.adminSensitiveOperationService.assertGranted(
    session,
    CONTENT_SAFETY_MANAGE_OPERATION,
  );
  const result = await this.adminConsoleService.getContentSafetyConfig();

  await this.auditInterceptor.record({
    appId: "common",
    action: "admin.content_safety.read",
    resourceType: "app_config",
    resourceId: result.configKey,
    payload: {
      adminUser: session.username,
    },
  });

  return this.ok(result, request.requestId as string);
}

export async function handleAdminUpdateContentSafety(this: BackendRouteContext, 
  request: HttpRequest,
): Promise<HttpResponse<AdminContentSafetyDocument>> {
  const session = this.requireAdminSession(request);
  await this.adminSensitiveOperationService.assertGranted(
    session,
    CONTENT_SAFETY_MANAGE_OPERATION,
  );
  const body = this.validationPipe.asObject(request.body);
  const desc = this.validationPipe.optionalString(body, "desc");
  const result = await this.adminConsoleService.updateContentSafetyConfig(
    body,
    desc,
  );

  await this.auditInterceptor.record({
    appId: "common",
    action: "admin.content_safety.update",
    resourceType: "app_config",
    resourceId: result.configKey,
    payload: {
      adminUser: session.username,
    },
  });

  return this.ok(result, request.requestId as string);
}

export async function handleAdminTestContentSafety(this: BackendRouteContext, 
  request: HttpRequest,
): Promise<HttpResponse<AdminContentSafetyTestDocument>> {
  const session = this.requireAdminSession(request);
  await this.adminSensitiveOperationService.assertGranted(
    session,
    CONTENT_SAFETY_MANAGE_OPERATION,
  );
  const body = this.validationPipe.asObject(request.body);
  const text = this.validationPipe.requireString(body, "text");
  const result = await this.contentSafetyService.testUserInput({
    appId: "admin",
    userId: session.username,
    requestId: request.requestId as string,
    taskType: "admin_content_safety_test",
    source: "admin_test",
    text,
  });

  await this.auditInterceptor.record({
    appId: "common",
    action: "admin.content_safety.test",
    resourceType: "app_config",
    resourceId: "common.content_safety",
    payload: {
      adminUser: session.username,
      allowed: result.allowed,
      layer: result.layer,
      textLength: result.textLength,
      failureReason: result.failureReason,
    },
  });

  return this.ok(result, request.requestId as string);
}

export async function handleAdminListContentSafetyBlockRecords(this: BackendRouteContext, 
  request: HttpRequest,
): Promise<HttpResponse<unknown>> {
  const session = this.requireAdminSession(request);
  await this.adminSensitiveOperationService.assertGranted(
    session,
    CONTENT_SAFETY_MANAGE_OPERATION,
  );
  const result = await this.contentSafetyService.listBlockRecords({
    dateFrom: request.query?.dateFrom,
    dateTo: request.query?.dateTo,
    appId: request.query?.appId,
    source: request.query?.source,
    method: request.query?.method,
    taskType: request.query?.taskType,
  });

  await this.auditInterceptor.record({
    appId: "common",
    action: "admin.content_safety.block_records.read",
    resourceType: "content_safety_check",
    resourceId: "blocked_records",
    payload: {
      adminUser: session.username,
      dateFrom: request.query?.dateFrom,
      dateTo: request.query?.dateTo,
      appId: request.query?.appId,
      source: request.query?.source,
      method: request.query?.method,
      taskType: request.query?.taskType,
      itemCount: result.items.length,
    },
  });

  return this.ok(result, request.requestId as string);
}

export async function handleAdminGetContentSafetyStats(this: BackendRouteContext, 
  request: HttpRequest,
): Promise<HttpResponse<unknown>> {
  const session = this.requireAdminSession(request);
  await this.adminSensitiveOperationService.assertGranted(
    session,
    CONTENT_SAFETY_MANAGE_OPERATION,
  );
  const result = await this.contentSafetyService.getStats({
    dateFrom: request.query?.dateFrom,
    dateTo: request.query?.dateTo,
    appId: request.query?.appId,
    source: request.query?.source,
    method: request.query?.method,
    taskType: request.query?.taskType,
  });

  await this.auditInterceptor.record({
    appId: "common",
    action: "admin.content_safety.stats.read",
    resourceType: "content_safety_check",
    resourceId: "stats",
    payload: {
      adminUser: session.username,
      dateFrom: request.query?.dateFrom,
      dateTo: request.query?.dateTo,
      appId: request.query?.appId,
      source: request.query?.source,
      method: request.query?.method,
      taskType: request.query?.taskType,
      total: result.summary.total,
      blocked: result.summary.blocked,
    },
  });

  return this.ok(result, request.requestId as string);
}

export async function handleAdminGetContentSafetyRevision(this: BackendRouteContext, 
  request: HttpRequest,
  revision: number,
): Promise<HttpResponse<AdminContentSafetyDocument>> {
  const session = this.requireAdminSession(request);
  await this.adminSensitiveOperationService.assertGranted(
    session,
    CONTENT_SAFETY_MANAGE_OPERATION,
  );
  const result =
    await this.adminConsoleService.getContentSafetyConfig(revision);

  await this.auditInterceptor.record({
    appId: "common",
    action: "admin.content_safety.revision.read",
    resourceType: "app_config",
    resourceId: `${result.configKey}:${revision}`,
    payload: {
      adminUser: session.username,
      revision,
    },
  });

  return this.ok(result, request.requestId as string);
}

export async function handleAdminRestoreContentSafetyRevision(this: BackendRouteContext, 
  request: HttpRequest,
  revision: number,
): Promise<HttpResponse<AdminContentSafetyDocument>> {
  const session = this.requireAdminSession(request);
  await this.adminSensitiveOperationService.assertGranted(
    session,
    CONTENT_SAFETY_MANAGE_OPERATION,
  );
  const body = this.validationPipe.asObject(request.body ?? {});
  const desc = this.validationPipe.optionalString(body, "desc");
  const result = await this.adminConsoleService.restoreContentSafetyConfig(
    revision,
    desc,
  );

  await this.auditInterceptor.record({
    appId: "common",
    action: "admin.content_safety.restore",
    resourceType: "app_config",
    resourceId: `${result.configKey}:${revision}`,
    payload: {
      adminUser: session.username,
      revision,
    },
  });

  return this.ok(result, request.requestId as string);
}

export async function handleAdminUpsertPasswordItem(this: BackendRouteContext, 
  request: HttpRequest,
): Promise<HttpResponse<unknown>> {
  const adminUser = this.authenticateAdmin(request);
  const body = this.validationPipe.asObject(request.body);
  const result = await this.adminConsoleService.upsertPasswordItem(body);

  await this.auditInterceptor.record({
    appId: "common",
    action: "admin.password.update",
    resourceType: "app_config",
    resourceId: result.configKey,
    payload: {
      adminUser,
      key: typeof body.key === "string" ? body.key : undefined,
    },
  });

  return this.ok(result, request.requestId as string);
}

export async function handleAdminDeletePasswordItem(this: BackendRouteContext, 
  request: HttpRequest,
  key: string,
): Promise<HttpResponse<unknown>> {
  const adminUser = this.authenticateAdmin(request);
  const result = await this.adminConsoleService.deletePasswordItem(key);

  await this.auditInterceptor.record({
    appId: "common",
    action: "admin.password.delete",
    resourceType: "app_config",
    resourceId: result.configKey,
    payload: {
      adminUser,
      key,
    },
  });

  return this.ok(result, request.requestId as string);
}
