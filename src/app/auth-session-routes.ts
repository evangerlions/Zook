import { ApplicationError } from "../shared/errors.ts";
import type { HttpRequest, HttpResponse } from "../shared/types.ts";
import { getHeader, maskSensitiveString } from "../shared/utils.ts";
import { PublicContractValidator } from "../generated/openapi/public-contract-validator.ts";
import type { BackendRouteContext } from "./backend-route-context.ts";

export async function handleCreateQrLogin(this: BackendRouteContext, 
  request: HttpRequest,
): Promise<HttpResponse<unknown>> {
  const body = this.validationPipe.asObject(request.body);
  this.requireValidPublicContract(
    PublicContractValidator.validateQrLoginCreate(body),
    request,
  );
  const appId = this.appContextResolver.resolvePreAuth(request);

  try {
    const result = await this.qrLoginService.createSession({ appId });

    await this.auditInterceptor.record({
      appId,
      action: "auth.qr_login.create",
      resourceType: "qr_login_session",
      resourceId: result.loginId,
      payload: {
        expiresInSeconds: result.expiresInSeconds,
      },
    });

    return this.ok(result, request.requestId as string);
  } catch (error) {
    await this.auditInterceptor.record({
      appId,
      action: "auth.qr_login.create",
      resourceType: "qr_login_session",
      payload: {
        errorCode:
          error instanceof ApplicationError
            ? error.code
            : "SYS_INTERNAL_ERROR",
      },
    });
    throw error;
  }
}

export async function handleConfirmQrLogin(this: BackendRouteContext, 
  request: HttpRequest,
  loginId: string,
): Promise<HttpResponse<unknown>> {
  const auth = await this.authenticate(request);
  const body = this.validationPipe.asObject(request.body);
  const appId =
    this.validationPipe.optionalString(body, "appId") ?? auth.appId;
  const scanToken = this.validationPipe.requireString(body, "scanToken");

  try {
    const result = await this.qrLoginService.confirm({
      appId,
      loginId,
      scanToken,
      userId: auth.userId,
    });

    await this.auditInterceptor.record({
      appId: auth.appId,
      actorUserId: auth.userId,
      action: "auth.qr_login.confirm",
      resourceType: "qr_login_session",
      resourceId: loginId,
      resourceOwnerUserId: auth.userId,
      payload: {
        confirmed: true,
      },
    });

    return this.ok(result, request.requestId as string);
  } catch (error) {
    await this.auditInterceptor.record({
      appId: auth.appId,
      actorUserId: auth.userId,
      action: "auth.qr_login.confirm",
      resourceType: "qr_login_session",
      resourceId: loginId,
      resourceOwnerUserId: auth.userId,
      payload: {
        confirmed: false,
        errorCode:
          error instanceof ApplicationError
            ? error.code
            : "SYS_INTERNAL_ERROR",
      },
    });
    throw error;
  }
}

export async function handlePollQrLogin(this: BackendRouteContext, 
  request: HttpRequest,
  loginId: string,
): Promise<HttpResponse<unknown>> {
  const appId = this.appContextResolver.resolvePreAuth(request);
  const pollToken = this.validationPipe.requireQueryString(
    request.query,
    "pollToken",
  );

  try {
    const result = await this.qrLoginService.poll({
      appId,
      loginId,
      pollToken,
    });

    await this.auditInterceptor.record({
      appId,
      action: "auth.qr_login.poll",
      resourceType: "qr_login_session",
      resourceId: loginId,
      payload: {
        status: result.status,
      },
    });

    if (result.status === "CONFIRMED") {
      return this.ok(
        {
          status: "CONFIRMED" as const,
          ...(await this.toAuthPayload(result, "web")),
        },
        request.requestId as string,
        this.buildAuthHeaders(result.refreshToken, "web"),
      );
    }

    return this.ok(result, request.requestId as string);
  } catch (error) {
    await this.auditInterceptor.record({
      appId,
      action: "auth.qr_login.poll",
      resourceType: "qr_login_session",
      resourceId: loginId,
      payload: {
        errorCode:
          error instanceof ApplicationError
            ? error.code
            : "SYS_INTERNAL_ERROR",
      },
    });
    throw error;
  }
}

export async function handleRefresh(this: BackendRouteContext, 
  request: HttpRequest,
): Promise<HttpResponse<unknown>> {
  const body = this.validationPipe.asObject(request.body);
  const validated = this.requireValidPublicContract(
    PublicContractValidator.validateRefresh(body),
    request,
  );
  const clientType = this.getClientType(validated);
  const session = await this.authService.refresh({
    appId: validated.appId?.trim(),
    refreshToken: validated.refreshToken?.trim(),
    cookieRefreshToken: request.cookies?.refreshToken,
  });

  return this.ok(
    await this.toAuthPayload(session, clientType),
    request.requestId as string,
    this.buildAuthHeaders(session.refreshToken, clientType),
  );
}

export async function handleGetCurrentUser(this: BackendRouteContext, 
  request: HttpRequest,
): Promise<HttpResponse<CurrentUserDocument>> {
  const auth = await this.authenticate(request);
  const appId = this.appContextResolver.resolvePostAuth(request, auth.appId);
  const result: CurrentUserDocument = {
    appId,
    user: await this.userService.getProfile(auth.userId),
  };

  await this.auditInterceptor.record({
    appId,
    actorUserId: auth.userId,
    action: "user.profile.read_self",
    resourceType: "user",
    resourceId: auth.userId,
    resourceOwnerUserId: auth.userId,
    payload: {
      self: true,
    },
  });

  return this.ok(result, request.requestId as string);
}

export async function handleLogout(this: BackendRouteContext, 
  request: HttpRequest,
): Promise<HttpResponse<unknown>> {
  const auth = await this.authenticate(request, {
    requireActiveMembership: false,
  });
  const body = this.validationPipe.asObject(request.body);
  const validated = this.requireValidPublicContract(
    PublicContractValidator.validateLogout(body),
    request,
  );
  const requestedAppId = validated.appId?.trim() ?? auth.appId;
  const scope = validated.scope === "all" ? "all" : "current";

  this.appAccessGuard.assertScope(requestedAppId, auth.appId);
  const revoked = await this.authService.logout(
    {
      appId: requestedAppId,
      scope,
      refreshToken: validated.refreshToken?.trim(),
      cookieRefreshToken: request.cookies?.refreshToken,
    },
    auth,
  );

  await this.auditInterceptor.record({
    appId: auth.appId,
    actorUserId: auth.userId,
    action: "auth.logout",
    resourceType: "user_session",
    resourceOwnerUserId: auth.userId,
    payload: {
      scope,
      revoked,
    },
  });

  return this.ok({ revoked }, request.requestId as string, {
    "Set-Cookie": this.authService.buildClearRefreshCookie(),
  });
}

export async function handleDeleteCurrentAppAccount(this: BackendRouteContext, 
  request: HttpRequest,
): Promise<HttpResponse<unknown>> {
  const auth = await this.authenticate(request);
  const body = this.validationPipe.asObject(request.body);
  const appId = this.validationPipe.requireString(body, "appId").trim();
  const confirmation = this.validationPipe.requireString(
    body,
    "confirmation",
  );
  this.appAccessGuard.assertScope(appId, auth.appId);

  try {
    const result = await this.authService.deleteCurrentAppAccount({
      appId,
      userId: auth.userId,
      confirmation,
    });

    await this.auditInterceptor.record({
      appId,
      actorUserId: auth.userId,
      action: "user.account.delete_app",
      resourceType: "app_user",
      resourceOwnerUserId: auth.userId,
      payload: {
        deleted: true,
        revokedSessions: result.revokedSessions,
      },
    });

    return this.ok(result, request.requestId as string, {
      "Set-Cookie": this.authService.buildClearRefreshCookie(),
    });
  } catch (error) {
    await this.auditInterceptor.record({
      appId,
      actorUserId: auth.userId,
      action: "user.account.delete_app",
      resourceType: "app_user",
      resourceOwnerUserId: auth.userId,
      payload: {
        deleted: false,
        errorCode:
          error instanceof ApplicationError
            ? error.code
            : "SYS_INTERNAL_ERROR",
      },
    });
    throw error;
  }
}
