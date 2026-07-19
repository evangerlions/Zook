import { ApplicationError } from "../shared/errors.ts";
import type { HttpRequest, HttpResponse } from "../shared/types.ts";
import { getHeader, maskSensitiveString } from "../shared/utils.ts";
import { PublicContractValidator } from "../generated/openapi/public-contract-validator.ts";
import type { BackendRouteContext } from "./backend-route-context.ts";

export async function handleSendPasswordCode(this: BackendRouteContext, 
  request: HttpRequest,
): Promise<HttpResponse<unknown>> {
  const body = this.validationPipe.asObject(request.body);
  const validated = this.requireValidPublicContract(
    PublicContractValidator.validateEmailCode(body),
    request,
  );
  const appId = this.appContextResolver.resolvePreAuth(request);
  const email = validated.email.trim();
  const ipAddress = request.ipAddress ?? "unknown";
  const emailContext = await this.requestEmailContextService.resolve(request);

  try {
    const result = await this.authService.sendPasswordCode({
      appId,
      email,
      ipAddress,
      locale: emailContext.locale,
      region: emailContext.region,
    });

    await this.auditInterceptor.record({
      appId,
      action: "auth.password.email_code",
      resourceType: "user_password_reset",
      payload: {
        email,
        ipAddress,
        accepted: true,
        resolvedLocale: emailContext.locale,
        localeSource: emailContext.localeSource,
        resolvedCountryCode: emailContext.countryCode,
        countrySource: emailContext.countrySource,
        resolvedRegion: emailContext.region,
      },
    });

    return this.ok(result, request.requestId as string);
  } catch (error) {
    await this.auditInterceptor.record({
      appId,
      action: "auth.password.email_code",
      resourceType: "user_password_reset",
      payload: {
        email,
        ipAddress,
        accepted: false,
        resolvedLocale: emailContext.locale,
        localeSource: emailContext.localeSource,
        resolvedCountryCode: emailContext.countryCode,
        countrySource: emailContext.countrySource,
        resolvedRegion: emailContext.region,
        errorCode:
          error instanceof ApplicationError
            ? error.code
            : "SYS_INTERNAL_ERROR",
      },
    });
    throw error;
  }
}

export async function handleSendPasswordSmsCode(this: BackendRouteContext, 
  request: HttpRequest,
): Promise<HttpResponse<unknown>> {
  const body = this.validationPipe.asObject(request.body);
  const appId = this.appContextResolver.resolvePreAuth(request);
  const phone = this.validationPipe.requireString(body, "phone");
  const phoneNa = this.validationPipe.optionalString(body, "phoneNa");
  const test = this.validationPipe.optionalBoolean(body, "test");
  const ipAddress = request.ipAddress ?? "unknown";

  try {
    const result = await this.authService.sendPasswordSmsCode({
      appId,
      phone,
      phoneNa,
      test,
      ipAddress,
    });

    await this.auditInterceptor.record({
      appId,
      action: "auth.password.sms_code",
      resourceType: "user_password_reset",
      payload: {
        phone,
        phoneNa,
        test,
        ipAddress,
        accepted: true,
      },
    });

    return this.ok(result, request.requestId as string);
  } catch (error) {
    await this.auditInterceptor.record({
      appId,
      action: "auth.password.sms_code",
      resourceType: "user_password_reset",
      payload: {
        phone,
        phoneNa,
        test,
        ipAddress,
        accepted: false,
        errorCode:
          error instanceof ApplicationError
            ? error.code
            : "SYS_INTERNAL_ERROR",
      },
    });
    throw error;
  }
}

export async function handleResetPassword(this: BackendRouteContext, 
  request: HttpRequest,
): Promise<HttpResponse<unknown>> {
  const body = this.validationPipe.asObject(request.body);
  const validated = this.requireValidPublicContract(
    PublicContractValidator.validateResetPassword(body),
    request,
  );
  const appId = this.appContextResolver.resolvePreAuth(request);
  const email = validated.email.trim();
  const password = validated.password;
  const emailCode = validated.emailCode.trim();
  const clientType = this.getClientType(validated);
  const ipAddress = request.ipAddress ?? "unknown";

  try {
    const session = await this.authService.resetPassword({
      appId,
      email,
      password,
      emailCode,
      ipAddress,
    });

    await this.auditInterceptor.record({
      appId: session.appId,
      actorUserId: session.userId,
      action: "auth.password.reset",
      resourceType: "user_session",
      resourceId: session.userId,
      resourceOwnerUserId: session.userId,
      payload: {
        email,
        clientType,
        ipAddress,
      },
    });

    return this.ok(
      await this.toAuthPayload(session, clientType),
      request.requestId as string,
      this.buildAuthHeaders(session.refreshToken, clientType),
    );
  } catch (error) {
    await this.auditInterceptor.record({
      appId,
      action: "auth.password.reset",
      resourceType: "user_password_reset",
      payload: {
        email,
        clientType,
        ipAddress,
        errorCode:
          error instanceof ApplicationError
            ? error.code
            : "SYS_INTERNAL_ERROR",
      },
    });
    throw error;
  }
}

export async function handleResetPasswordBySms(this: BackendRouteContext, 
  request: HttpRequest,
): Promise<HttpResponse<unknown>> {
  const body = this.validationPipe.asObject(request.body);
  const appId = this.appContextResolver.resolvePreAuth(request);
  const phone = this.validationPipe.requireString(body, "phone");
  const phoneNa = this.validationPipe.optionalString(body, "phoneNa");
  const password = this.validationPipe.requireString(body, "password");
  const smsCode = this.validationPipe.requireString(body, "smsCode");
  const clientType = this.getClientType(body);
  const ipAddress = request.ipAddress ?? "unknown";

  try {
    const session = await this.authService.resetPasswordBySms({
      appId,
      phone,
      phoneNa,
      password,
      smsCode,
      ipAddress,
    });

    await this.auditInterceptor.record({
      appId: session.appId,
      actorUserId: session.userId,
      action: "auth.password.reset_sms",
      resourceType: "user_session",
      resourceId: session.userId,
      resourceOwnerUserId: session.userId,
      payload: {
        phone,
        phoneNa,
        clientType,
        ipAddress,
      },
    });

    return this.ok(
      await this.toAuthPayload(session, clientType),
      request.requestId as string,
      this.buildAuthHeaders(session.refreshToken, clientType),
    );
  } catch (error) {
    await this.auditInterceptor.record({
      appId,
      action: "auth.password.reset_sms",
      resourceType: "user_password_reset",
      payload: {
        phone,
        phoneNa,
        clientType,
        ipAddress,
        errorCode:
          error instanceof ApplicationError
            ? error.code
            : "SYS_INTERNAL_ERROR",
      },
    });
    throw error;
  }
}

export async function handleChangePassword(this: BackendRouteContext, 
  request: HttpRequest,
): Promise<HttpResponse<unknown>> {
  const auth = await this.authenticate(request);
  const body = this.validationPipe.asObject(request.body);
  const validated = this.requireValidPublicContract(
    PublicContractValidator.validateChangePassword(body),
    request,
  );
  const requestedAppId = validated.appId ?? auth.appId;
  const currentPassword = validated.currentPassword;
  const newPassword = validated.newPassword;
  const clientType = this.getClientType(validated);

  this.appAccessGuard.assertScope(requestedAppId, auth.appId);
  const session = await this.authService.changePassword({
    appId: requestedAppId,
    userId: auth.userId,
    currentPassword,
    newPassword,
  });

  await this.auditInterceptor.record({
    appId: auth.appId,
    actorUserId: auth.userId,
    action: "auth.password.change",
    resourceType: "user_session",
    resourceOwnerUserId: auth.userId,
    payload: {
      clientType,
    },
  });

  return this.ok(
    await this.toAuthPayload(session, clientType),
    request.requestId as string,
    this.buildAuthHeaders(session.refreshToken, clientType),
  );
}

export async function handleSetPassword(this: BackendRouteContext, 
  request: HttpRequest,
): Promise<HttpResponse<unknown>> {
  const auth = await this.authenticate(request);
  const body = this.validationPipe.asObject(request.body);
  const validated = this.requireValidPublicContract(
    PublicContractValidator.validateSetPassword(body),
    request,
  );
  const requestedAppId = validated.appId ?? auth.appId;
  const password = validated.password;
  const clientType = this.getClientType(validated);

  this.appAccessGuard.assertScope(requestedAppId, auth.appId);
  const session = await this.authService.setPassword({
    appId: requestedAppId,
    userId: auth.userId,
    password,
  });

  await this.auditInterceptor.record({
    appId: auth.appId,
    actorUserId: auth.userId,
    action: "auth.password.set",
    resourceType: "user_session",
    resourceOwnerUserId: auth.userId,
    payload: {
      clientType,
    },
  });

  return this.ok(
    await this.toAuthPayload(session, clientType),
    request.requestId as string,
    this.buildAuthHeaders(session.refreshToken, clientType),
  );
}
