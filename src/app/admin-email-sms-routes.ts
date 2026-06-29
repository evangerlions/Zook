import { ApplicationError, isApplicationError } from "../shared/errors.ts";
import type { HttpRequest, HttpResponse } from "../shared/types.ts";
import { getHeader } from "../shared/utils.ts";
import { PublicContractValidator } from "../generated/openapi/public-contract-validator.ts";
import type { BackendRouteContext } from "./backend-route-context.ts";
import { commonAppSummary } from "../modules/admin/admin-console-config-utils.ts";


export async function tryHandleAdminEmailSmsRoutes(
  this: BackendRouteContext,
  request: HttpRequest,
): Promise<HttpResponse<unknown> | undefined> {
  if (request.method === "GET" && request.path === "/api/v1/admin/apps/common/email-service") return await handleAdminGetEmailService.call(this, request);
  if (request.method === "PUT" && request.path === "/api/v1/admin/apps/common/email-service") return await handleAdminUpdateEmailService.call(this, request);
  if (request.method === "POST" && request.path === "/api/v1/admin/apps/common/email-service/test-send") return await handleAdminSendTestEmail.call(this, request);
  if (request.method === "GET" && request.path === "/api/v1/admin/apps/common/email-service/events") return await handleAdminListEmailDeliveryEvents.call(this, request);
  const adminEmailRevisionMatch = request.path.match(/^\/api\/v1\/admin\/apps\/common\/email-service\/revisions\/(\d+)$/);
  if (request.method === "GET" && adminEmailRevisionMatch) return await handleAdminGetEmailServiceRevision.call(this, request, Number(adminEmailRevisionMatch[1]));
  const adminEmailRestoreMatch = request.path.match(/^\/api\/v1\/admin\/apps\/common\/email-service\/revisions\/(\d+)\/restore$/);
  if (request.method === "POST" && adminEmailRestoreMatch) return await handleAdminRestoreEmailServiceRevision.call(this, request, Number(adminEmailRestoreMatch[1]));
  if (request.method === "GET" && request.path === "/api/v1/admin/apps/common/sms-service") return await handleAdminGetSmsService.call(this, request);
  if (request.method === "PUT" && request.path === "/api/v1/admin/apps/common/sms-service") return await handleAdminUpdateSmsService.call(this, request);
  const adminSmsServiceRevisionMatch = request.path.match(/^\/api\/v1\/admin\/apps\/common\/sms-service\/revisions\/(\d+)$/);
  if (request.method === "GET" && adminSmsServiceRevisionMatch) return await handleAdminGetSmsServiceRevision.call(this, request, Number(adminSmsServiceRevisionMatch[1]));
  const adminSmsServiceRestoreMatch = request.path.match(/^\/api\/v1\/admin\/apps\/common\/sms-service\/revisions\/(\d+)\/restore$/);
  if (request.method === "POST" && adminSmsServiceRestoreMatch) return await handleAdminRestoreSmsServiceRevision.call(this, request, Number(adminSmsServiceRestoreMatch[1]));
  return undefined;
}

export async function handleAdminListEmailDeliveryEvents(this: BackendRouteContext,
  request: HttpRequest,
): Promise<HttpResponse<unknown>> {
  const adminUser = this.authenticateAdmin(request);
  const event = typeof request.query?.event === "string" ? request.query.event : undefined;
  const email = typeof request.query?.email === "string" ? request.query.email : undefined;
  const limit = typeof request.query?.limit === "string" ? Number(request.query.limit) : undefined;
  const result = await this.tencentSesEmailCallbackService.listForAdmin(
    commonAppSummary(),
    { event, email, limit },
  );

  await this.auditInterceptor.record({
    appId: "common",
    action: "admin.email_event.read",
    resourceType: "email_delivery_event",
    resourceId: event || email || "latest",
    payload: {
      adminUser,
      event,
      email,
      limit,
    },
  });

  return this.ok(result, request.requestId as string);
}

export async function handleAdminGetEmailService(this: BackendRouteContext, 
  request: HttpRequest,
): Promise<HttpResponse<unknown>> {
  const adminUser = this.authenticateAdmin(request);
  const result = await this.adminConsoleService.getEmailServiceConfig();

  await this.auditInterceptor.record({
    appId: "common",
    action: "admin.email_service.read",
    resourceType: "app_config",
    resourceId: result.configKey,
    payload: {
      adminUser,
    },
  });

  return this.ok(result, request.requestId as string);
}

export async function handleAdminUpdateEmailService(this: BackendRouteContext, 
  request: HttpRequest,
): Promise<HttpResponse<unknown>> {
  const adminUser = this.authenticateAdmin(request);
  const body = this.validationPipe.asObject(request.body);
  const desc = this.validationPipe.optionalString(body, "desc");
  const result = await this.adminConsoleService.updateEmailServiceConfig(
    body as AdminEmailServiceDocument["config"],
    desc,
  );

  await this.auditInterceptor.record({
    appId: "common",
    action: "admin.email_service.update",
    resourceType: "app_config",
    resourceId: result.configKey,
    payload: {
      adminUser,
    },
  });

  return this.ok(result, request.requestId as string);
}

export async function handleAdminSendTestEmail(this: BackendRouteContext, 
  request: HttpRequest,
): Promise<HttpResponse<unknown>> {
  try {
    const adminUser = this.authenticateAdmin(request);
    const body = this.validationPipe.asObject(request.body);
    const result = await this.adminConsoleService.sendEmailTest({
      recipientEmail: this.validationPipe.requireString(
        body,
        "recipientEmail",
      ),
      region: this.validationPipe.requireString(
        body,
        "region",
      ) as AdminEmailTestSendDocument["sender"]["region"],
      templateId: this.validationPipe.requireNumber(body, "templateId"),
      appName: this.validationPipe.requireString(body, "appName"),
      code: this.validationPipe.requireString(body, "code"),
      expireMinutes: this.validationPipe.requireNumber(body, "expireMinutes"),
    });

    await this.auditInterceptor.record({
      appId: "common",
      action: "admin.email_service.test_send",
      resourceType: "app_config",
      resourceId: `${result.template.templateId}:${result.recipientEmail}`,
      payload: {
        adminUser,
        recipientEmail: result.recipientEmail,
        region: result.sender.region,
        templateId: result.template.templateId,
      },
    });

    return this.ok(result, request.requestId as string);
  } catch (error) {
    if (
      isApplicationError(error) &&
      error.code === "EMAIL_PROVIDER_REQUEST_FAILED"
    ) {
      return {
        statusCode: error.statusCode,
        body: {
          code: error.code,
          message: error.message,
          data: error.details ?? null,
          requestId: request.requestId as string,
        },
      };
    }

    throw error;
  }
}

export async function handleAdminGetSmsService(this: BackendRouteContext, 
  request: HttpRequest,
): Promise<HttpResponse<unknown>> {
  const adminUser = this.authenticateAdmin(request);
  const result = await this.adminConsoleService.getSmsServiceConfig();

  await this.auditInterceptor.record({
    appId: "common",
    action: "admin.sms_service.read",
    resourceType: "app_config",
    resourceId: result.configKey,
    payload: {
      adminUser,
    },
  });

  return this.ok(result, request.requestId as string);
}

export async function handleAdminUpdateSmsService(this: BackendRouteContext, 
  request: HttpRequest,
): Promise<HttpResponse<unknown>> {
  const adminUser = this.authenticateAdmin(request);
  const body = this.validationPipe.asObject(request.body);
  const desc = this.validationPipe.optionalString(body, "desc");
  const result = await this.adminConsoleService.updateSmsServiceConfig(
    body as AdminSmsServiceDocument["config"],
    desc,
  );

  await this.auditInterceptor.record({
    appId: "common",
    action: "admin.sms_service.update",
    resourceType: "app_config",
    resourceId: result.configKey,
    payload: {
      adminUser,
    },
  });

  return this.ok(result, request.requestId as string);
}

export async function handleAdminGetEmailServiceRevision(this: BackendRouteContext, 
  request: HttpRequest,
  revision: number,
): Promise<HttpResponse<unknown>> {
  const adminUser = this.authenticateAdmin(request);
  const result =
    await this.adminConsoleService.getEmailServiceConfig(revision);

  await this.auditInterceptor.record({
    appId: "common",
    action: "admin.email_service.revision.read",
    resourceType: "app_config",
    resourceId: `${result.configKey}:${revision}`,
    payload: {
      adminUser,
      revision,
    },
  });

  return this.ok(result, request.requestId as string);
}

export async function handleAdminRestoreEmailServiceRevision(this: BackendRouteContext, 
  request: HttpRequest,
  revision: number,
): Promise<HttpResponse<unknown>> {
  const adminUser = this.authenticateAdmin(request);
  const body = this.validationPipe.asObject(request.body ?? {});
  const desc = this.validationPipe.optionalString(body, "desc");
  const result = await this.adminConsoleService.restoreEmailServiceConfig(
    revision,
    desc,
  );

  await this.auditInterceptor.record({
    appId: "common",
    action: "admin.email_service.restore",
    resourceType: "app_config",
    resourceId: `${result.configKey}:${revision}`,
    payload: {
      adminUser,
      revision,
    },
  });

  return this.ok(result, request.requestId as string);
}

export async function handleAdminGetSmsServiceRevision(this: BackendRouteContext, 
  request: HttpRequest,
  revision: number,
): Promise<HttpResponse<unknown>> {
  const adminUser = this.authenticateAdmin(request);
  const result = await this.adminConsoleService.getSmsServiceConfig(revision);

  await this.auditInterceptor.record({
    appId: "common",
    action: "admin.sms_service.revision.read",
    resourceType: "app_config",
    resourceId: `${result.configKey}:${revision}`,
    payload: {
      adminUser,
      revision,
    },
  });

  return this.ok(result, request.requestId as string);
}

export async function handleAdminRestoreSmsServiceRevision(this: BackendRouteContext, 
  request: HttpRequest,
  revision: number,
): Promise<HttpResponse<unknown>> {
  const adminUser = this.authenticateAdmin(request);
  const body = this.validationPipe.asObject(request.body ?? {});
  const desc = this.validationPipe.optionalString(body, "desc");
  const result = await this.adminConsoleService.restoreSmsServiceConfig(
    revision,
    desc,
  );

  await this.auditInterceptor.record({
    appId: "common",
    action: "admin.sms_service.restore",
    resourceType: "app_config",
    resourceId: `${result.configKey}:${revision}`,
    payload: {
      adminUser,
      revision,
    },
  });

  return this.ok(result, request.requestId as string);
}
