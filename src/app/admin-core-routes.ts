import { ApplicationError } from "../shared/errors.ts";
import type { HttpRequest, HttpResponse } from "../shared/types.ts";
import { getHeader } from "../shared/utils.ts";
import { PublicContractValidator } from "../generated/openapi/public-contract-validator.ts";
import { APP_LOG_SECRET_READ_OPERATION } from "../services/app-log-secret.service.ts";
import type { BackendRouteContext } from "./backend-route-context.ts";

const ADMIN_SESSION_COOKIE_NAME = "adminSession";
const ADMIN_SESSION_TTL_MS = 14 * 24 * 60 * 60 * 1000;


export async function tryHandleAdminCoreRoutes(
  this: BackendRouteContext,
  request: HttpRequest,
): Promise<HttpResponse<unknown> | undefined> {
  const publicConfigMatch = request.path.match(/^\/api\/v1\/([^/]+)\/public\/config$/);
  if (request.method === "GET" && publicConfigMatch) {
    return await handleGetPublicAppConfig.call(this, request, decodeURIComponent(publicConfigMatch[1] as string));
  }
  if (request.method === "POST" && request.path === "/api/v1/admin/auth/login") {
    return await handleAdminLogin.call(this, request);
  }
  if (request.method === "POST" && request.path === "/api/v1/admin/auth/logout") {
    return await handleAdminLogout.call(this, request);
  }
  if (request.method === "GET" && request.path === "/api/v1/admin/bootstrap") {
    return await handleAdminBootstrap.call(this, request);
  }
  if (request.method === "POST" && request.path === "/api/v1/admin/sensitive-operations/request-code") {
    return await handleAdminRequestSensitiveOperationCode.call(this, request);
  }
  if (request.method === "POST" && request.path === "/api/v1/admin/sensitive-operations/verify") {
    return await handleAdminVerifySensitiveOperationCode.call(this, request);
  }
  if (request.method === "POST" && request.path === "/api/v1/admin/apps") {
    return await handleAdminCreateApp.call(this, request);
  }
  const adminAppNamesMatch = request.path.match(/^\/api\/v1\/admin\/apps\/([^/]+)\/names$/);
  if (request.method === "PUT" && adminAppNamesMatch) {
    return await handleAdminUpdateAppNames.call(this, request, decodeURIComponent(adminAppNamesMatch[1] as string));
  }
  const adminAppMatch = request.path.match(/^\/api\/v1\/admin\/apps\/([^/]+)$/);
  if (request.method === "DELETE" && adminAppMatch) {
    return await handleAdminDeleteApp.call(this, request, decodeURIComponent(adminAppMatch[1] as string));
  }
  const adminAppLogSecretRevealMatch = request.path.match(/^\/api\/v1\/admin\/apps\/([^/]+)\/log-secret\/reveal$/);
  if (request.method === "POST" && adminAppLogSecretRevealMatch) {
    return await handleAdminRevealAppLogSecret.call(this, request, decodeURIComponent(adminAppLogSecretRevealMatch[1] as string));
  }
  return undefined;
}

export async function handleAdminLogin(this: BackendRouteContext, 
  request: HttpRequest,
): Promise<HttpResponse<unknown>> {
  if (!this.adminBasicAuth) {
    throw new ApplicationError(
      401,
      "ADMIN_AUTH_REQUIRED",
      "Admin authentication is required.",
    );
  }

  const body = this.validationPipe.asObject(request.body);
  const username = this.validationPipe.requireString(body, "username");
  const password = this.validationPipe.requireString(body, "password");
  const adminUser = this.validateAdminCredentials(username, password);
  const session = await this.adminSessionStore.create(
    adminUser,
    ADMIN_SESSION_TTL_MS,
  );
  const bootstrap = await this.adminConsoleService.getBootstrap(adminUser);

  return this.ok(
    {
      ...bootstrap,
      sessionExpiresAt: session.expiresAt,
    },
    request.requestId as string,
    this.buildAdminSessionHeaders(session.id),
  );
}

export async function handleAdminLogout(this: BackendRouteContext, 
  request: HttpRequest,
): Promise<HttpResponse<unknown>> {
  const sessionId = request.cookies?.[ADMIN_SESSION_COOKIE_NAME];
  if (sessionId) {
    await this.adminSessionStore.delete(sessionId);
  }

  return this.ok(
    { loggedOut: true },
    request.requestId as string,
    this.buildAdminSessionClearHeaders(),
  );
}

export async function handleAdminBootstrap(this: BackendRouteContext, 
  request: HttpRequest,
): Promise<HttpResponse<unknown>> {
  const adminUser = this.authenticateAdmin(request);
  const result = await this.adminConsoleService.getBootstrap(adminUser);

  return this.ok(
    {
      ...result,
      sessionExpiresAt: request.adminSession?.expiresAt,
    },
    request.requestId as string,
  );
}

export async function handleGetPublicAppConfig(this: BackendRouteContext, 
  request: HttpRequest,
  appId: string,
): Promise<HttpResponse<PublicAppConfigDocument>> {
  const authorization = getHeader(request.headers, "authorization");
  if (authorization) {
    const auth = this.authGuard.canActivate(request);
    this.appContextResolver.resolvePostAuth(request, auth.appId);
    this.appAccessGuard.assertScope(appId, auth.appId);
    await this.authService.assertAccessTokenActive(auth);
  } else {
    const requestAppId = getHeader(request.headers, "x-app-id");
    if (requestAppId && requestAppId !== appId) {
      throw new ApplicationError(
        403,
        "AUTH_APP_SCOPE_MISMATCH",
        `X-App-Id must match ${appId}.`,
      );
    }
  }

  const result = await this.adminConsoleService.getPublicConfig(appId);
  this.requireValidPublicContract(
    PublicContractValidator.validatePublicConfigData(result),
    request,
  );
  return this.ok(result, request.requestId as string);
}

export async function handleAdminRequestSensitiveOperationCode(this: BackendRouteContext, 
  request: HttpRequest,
): Promise<HttpResponse<AdminSensitiveOperationCodeRequestDocument>> {
  const session = this.requireAdminSession(request);
  const body = this.validationPipe.asObject(request.body);
  const operation = this.validationPipe.requireString(body, "operation");
  const result = await this.adminSensitiveOperationService.requestCode(
    session,
    operation,
  );

  await this.auditInterceptor.record({
    appId: "common",
    action: "admin.sensitive_operation.request_code",
    resourceType: "sensitive_operation",
    resourceId: result.operation,
    payload: {
      adminUser: session.username,
      recipientEmailMasked: result.recipientEmailMasked,
    },
  });

  return this.ok(result, request.requestId as string);
}

export async function handleAdminVerifySensitiveOperationCode(this: BackendRouteContext, 
  request: HttpRequest,
): Promise<HttpResponse<AdminSensitiveOperationGrantDocument>> {
  const session = this.requireAdminSession(request);
  const body = this.validationPipe.asObject(request.body);
  const operation = this.validationPipe.requireString(body, "operation");
  const code = this.validationPipe.requireString(body, "code");
  const result = await this.adminSensitiveOperationService.verifyCode(
    session,
    operation,
    code,
  );

  await this.auditInterceptor.record({
    appId: "common",
    action: "admin.sensitive_operation.verify",
    resourceType: "sensitive_operation",
    resourceId: result.operation,
    payload: {
      adminUser: session.username,
      expiresAt: result.expiresAt,
    },
  });

  return this.ok(result, request.requestId as string);
}

export async function handleAdminCreateApp(this: BackendRouteContext, 
  request: HttpRequest,
): Promise<HttpResponse<unknown>> {
  const adminUser = this.authenticateAdmin(request);
  const body = this.validationPipe.asObject(request.body);
  const appId = this.validationPipe.requireString(body, "appId");
  const appNameZhCn = this.validationPipe.requireString(body, "appNameZhCn");
  const appNameEnUs = this.validationPipe.requireString(body, "appNameEnUs");
  const result = await this.adminConsoleService.createApp(
    appId,
    appNameZhCn,
    appNameEnUs,
  );

  await this.auditInterceptor.record({
    appId: result.appId,
    action: "admin.app.create",
    resourceType: "app",
    resourceId: result.appId,
    payload: {
      adminUser,
    },
  });

  return this.ok(result, request.requestId as string);
}

export async function handleAdminUpdateAppNames(this: BackendRouteContext, 
  request: HttpRequest,
  appId: string,
): Promise<HttpResponse<AdminAppSummary>> {
  const adminUser = this.authenticateAdmin(request);
  const body = this.validationPipe.asObject(request.body);
  const appNameI18n = this.validationPipe.asObject(body.appNameI18n);
  const result = await this.adminConsoleService.updateAppNames(
    appId,
    appNameI18n,
  );

  await this.auditInterceptor.record({
    appId,
    action: "admin.app.update_names",
    resourceType: "app",
    resourceId: appId,
    payload: {
      adminUser,
      locales: Object.keys(result.appNameI18n),
    },
  });

  return this.ok(result, request.requestId as string);
}

export async function handleAdminRevealAppLogSecret(this: BackendRouteContext, 
  request: HttpRequest,
  appId: string,
): Promise<HttpResponse<AdminAppLogSecretRevealDocument>> {
  const session = this.requireAdminSession(request);
  await this.adminSensitiveOperationService.assertGranted(
    session,
    APP_LOG_SECRET_READ_OPERATION,
  );
  const result = await this.adminConsoleService.revealAppLogSecret(appId);

  await this.auditInterceptor.record({
    appId,
    action: "admin.app.log_secret.reveal",
    resourceType: "app_log_secret",
    resourceId: result.keyId,
    payload: {
      adminUser: session.username,
    },
  });

  return this.ok(result, request.requestId as string);
}

export async function handleAdminDeleteApp(this: BackendRouteContext, 
  request: HttpRequest,
  appId: string,
): Promise<HttpResponse<unknown>> {
  const adminUser = this.authenticateAdmin(request);
  const result = await this.adminConsoleService.deleteApp(appId);

  await this.auditInterceptor.record({
    appId,
    action: "admin.app.delete",
    resourceType: "app",
    resourceId: appId,
    payload: {
      adminUser,
    },
  });

  return this.ok(result, request.requestId as string);
}
