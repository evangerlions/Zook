import { ApplicationError } from "../shared/errors.ts";
import type { HttpRequest, HttpResponse } from "../shared/types.ts";
import { getHeader, maskSensitiveString } from "../shared/utils.ts";
import { PublicContractValidator } from "../generated/openapi/public-contract-validator.ts";
import type { BackendRouteContext } from "./backend-route-context.ts";

export async function handleLogin(this: BackendRouteContext, 
  request: HttpRequest,
): Promise<HttpResponse<unknown>> {
  const body = this.validationPipe.asObject(request.body);
  const validated = this.requireValidPublicContract(
    PublicContractValidator.validatePasswordLogin(body),
    request,
  );
  const appId = this.appContextResolver.resolvePreAuth(request);
  const account = validated.account.trim();
  const password = validated.password;
  const clientType = this.getClientType(validated);
  const session = await this.authService.login({ appId, account, password });

  await this.auditInterceptor.record({
    appId: session.appId,
    actorUserId: session.userId,
    action: "auth.login",
    resourceType: "user_session",
    resourceOwnerUserId: session.userId,
    payload: {
      clientType,
    },
  });

  return this.ok(
    await this.toAuthPayload(session, clientType, request),
    request.requestId as string,
    this.buildAuthHeaders(session.refreshToken, clientType),
  );
}

export async function handleRegisterEmailCode(this: BackendRouteContext, 
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
    const result = await this.authService.registerEmailCode({
      appId,
      email,
      ipAddress,
      locale: emailContext.locale,
      region: emailContext.region,
    });

    await this.auditInterceptor.record({
      appId,
      action: "auth.register.email_code",
      resourceType: "user_registration",
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
      action: "auth.register.email_code",
      resourceType: "user_registration",
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

export async function handleLoginEmailCode(this: BackendRouteContext, 
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
    const result = await this.authService.loginEmailCode({
      appId,
      email,
      ipAddress,
      locale: emailContext.locale,
      region: emailContext.region,
    });

    await this.auditInterceptor.record({
      appId,
      action: "auth.login.email_code",
      resourceType: "user_login",
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
      action: "auth.login.email_code",
      resourceType: "user_login",
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

export async function handleLoginSmsCode(this: BackendRouteContext, 
  request: HttpRequest,
): Promise<HttpResponse<unknown>> {
  const body = this.validationPipe.asObject(request.body);
  const appId = this.appContextResolver.resolvePreAuth(request);
  const phone = this.validationPipe.requireString(body, "phone");
  const phoneNa = this.validationPipe.optionalString(body, "phoneNa");
  const test = this.validationPipe.optionalBoolean(body, "test");
  const ipAddress = request.ipAddress ?? "unknown";

  try {
    const result = await this.authService.loginSmsCode({
      appId,
      phone,
      phoneNa,
      test,
      ipAddress,
    });

    await this.auditInterceptor.record({
      appId,
      action: "auth.login.sms_code",
      resourceType: "user_login",
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
      action: "auth.login.sms_code",
      resourceType: "user_login",
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

export async function handleLoginWithEmailCode(this: BackendRouteContext, 
  request: HttpRequest,
): Promise<HttpResponse<unknown>> {
  const body = this.validationPipe.asObject(request.body);
  const validated = this.requireValidPublicContract(
    PublicContractValidator.validateEmailLogin(body),
    request,
  );
  const appId = this.appContextResolver.resolvePreAuth(request);
  const email = validated.email.trim();
  const emailCode = validated.emailCode.trim();
  const clientType = this.getClientType(validated);
  const ipAddress = request.ipAddress ?? "unknown";
  const emailContext = await this.requestEmailContextService.resolve(request);

  try {
    const result = await this.authService.loginWithEmailCode({
      appId,
      email,
      emailCode,
      ipAddress,
    });

    await this.auditInterceptor.record({
      appId: result.session.appId,
      actorUserId: result.session.userId,
      action: "auth.login.email",
      resourceType: "user_session",
      resourceId: result.session.userId,
      resourceOwnerUserId: result.session.userId,
      payload: {
        email,
        clientType,
        ipAddress,
        autoCreatedUser: result.autoCreatedUser,
        resolvedLocale: emailContext.locale,
        localeSource: emailContext.localeSource,
        resolvedCountryCode: emailContext.countryCode,
        countrySource: emailContext.countrySource,
        resolvedRegion: emailContext.region,
      },
    });

    return this.ok(
      await this.toAuthPayload(result.session, clientType, request),
      request.requestId as string,
      this.buildAuthHeaders(result.session.refreshToken, clientType),
    );
  } catch (error) {
    await this.auditInterceptor.record({
      appId,
      action: "auth.login.email",
      resourceType: "user_login",
      payload: {
        email,
        clientType,
        ipAddress,
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

export async function handleLoginWithSmsCode(this: BackendRouteContext, 
  request: HttpRequest,
): Promise<HttpResponse<unknown>> {
  const body = this.validationPipe.asObject(request.body);
  const appId = this.appContextResolver.resolvePreAuth(request);
  const phone = this.validationPipe.requireString(body, "phone");
  const phoneNa = this.validationPipe.optionalString(body, "phoneNa");
  const smsCode = this.validationPipe.requireString(body, "smsCode");
  const clientType = this.getClientType(body);
  const ipAddress = request.ipAddress ?? "unknown";

  try {
    const result = await this.authService.loginWithSmsCode({
      appId,
      phone,
      phoneNa,
      smsCode,
      ipAddress,
    });

    await this.auditInterceptor.record({
      appId: result.session.appId,
      actorUserId: result.session.userId,
      action: "auth.login.sms",
      resourceType: "user_session",
      resourceId: result.session.userId,
      resourceOwnerUserId: result.session.userId,
      payload: {
        phone,
        phoneNa,
        clientType,
        ipAddress,
        autoCreatedUser: result.autoCreatedUser,
      },
    });

    return this.ok(
      await this.toAuthPayload(result.session, clientType, request),
      request.requestId as string,
      this.buildAuthHeaders(result.session.refreshToken, clientType),
    );
  } catch (error) {
    await this.auditInterceptor.record({
      appId,
      action: "auth.login.sms",
      resourceType: "user_login",
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

export async function handleLoginWithOneClick(this: BackendRouteContext, 
  request: HttpRequest,
): Promise<HttpResponse<unknown>> {
  const body = this.validationPipe.asObject(request.body);
  const validated = this.requireValidPublicContract(
    PublicContractValidator.validateOneClickLogin(body),
    request,
  );
  const appId = this.appContextResolver.resolvePreAuth(request);
  const token = validated.token.trim();
  const gyuid = validated.gyuid.trim();
  const clientType = this.getClientType(validated);
  const ipAddress = request.ipAddress ?? "unknown";
  const operator = validated.operator?.trim();
  const sdkPlatform = validated.sdkPlatform?.trim();
  const replayRequest = buildOneClickLoginReplayRequest.call(this, {
    appId,
    token,
    gyuid,
    clientType,
    operator,
    sdkPlatform,
  });

  try {
    const phoneResult = await this.getuiGyOneClickLoginService.exchangeToken({
      appId,
      token,
      gyuid,
    });
    const phone = phoneResult.phone.replace(/^\+86/, "");
    const result = await this.authService.loginWithOneClickPhone({
      appId,
      phone,
      phoneNa: "+86",
      ipAddress,
    });

    await this.auditInterceptor.record({
      appId: result.session.appId,
      actorUserId: result.session.userId,
      action: "auth.login.one_click",
      resourceType: "user_session",
      resourceId: result.session.userId,
      resourceOwnerUserId: result.session.userId,
      payload: {
        clientType,
        ipAddress,
        autoCreatedUser: result.autoCreatedUser,
        operator,
        sdkPlatform,
        providerResult: phoneResult.providerResult,
        providerMessage: phoneResult.providerMessage,
        ...buildOneClickLoginAuditDebugPayload.call(this, {
          replayRequest,
          providerRequest: phoneResult.debug.providerRequest,
          token,
          gyuid,
        }),
      },
    });

    return this.ok(
      await this.toAuthPayload(result.session, clientType, request),
      request.requestId as string,
      this.buildAuthHeaders(result.session.refreshToken, clientType),
    );
  } catch (error) {
    await this.auditInterceptor.record({
      appId,
      action: "auth.login.one_click",
      resourceType: "user_login",
      payload: {
        clientType,
        ipAddress,
        operator,
        sdkPlatform,
        ...buildOneClickLoginAuditDebugPayload.call(this, {
          replayRequest,
          errorDetails:
            error instanceof ApplicationError ? error.details : undefined,
          token,
          gyuid,
        }),
        errorCode:
          error instanceof ApplicationError
            ? error.code
            : "SYS_INTERNAL_ERROR",
      },
    });
    throw error;
  }
}

export async function handleOneClickLoginStatus(this: BackendRouteContext, 
  request: HttpRequest,
): Promise<HttpResponse<unknown>> {
  const appId = this.appContextResolver.resolvePreAuth(request);
  const config =
    await this.commonGetuiGyConfigService.getRuntimeConfig(appId);
  return this.ok(
    {
      available: true,
      appId,
      provider: "getui_gy",
      providerAppId: config.appId,
      endpoint: config.endpoint,
      timeoutMs: config.timeoutMs,
    },
    request.requestId as string,
  );
}

function buildOneClickLoginReplayRequest(this: BackendRouteContext, input: {
  appId: string;
  token: string;
  gyuid: string;
  clientType: string;
  operator?: string;
  sdkPlatform?: string;
}): Record<string, unknown> {
  return {
    method: "POST",
    path: "/api/v1/auth/login/one-click",
    body: {
      appId: input.appId,
      token: input.token,
      gyuid: input.gyuid,
      clientType: input.clientType,
      ...(input.operator ? { operator: input.operator } : {}),
      ...(input.sdkPlatform ? { sdkPlatform: input.sdkPlatform } : {}),
    },
  };
}

function buildOneClickLoginAuditDebugPayload(this: BackendRouteContext, input: {
  replayRequest: Record<string, unknown>;
  providerRequest?: unknown;
  errorDetails?: unknown;
  token: string;
  gyuid: string;
}): Record<string, unknown> {
  if (shouldLogFullOneClickLoginRequest.call(this, )) {
    return {
      replayRequest: input.replayRequest,
      ...(input.providerRequest
        ? { providerRequest: input.providerRequest }
        : {}),
      ...(input.errorDetails ? { errorDetails: input.errorDetails } : {}),
    };
  }

  return {
    requestSummary: {
      tokenMasked: maskSensitiveString(input.token),
      gyuidMasked: maskSensitiveString(input.gyuid),
    },
  };
}

function shouldLogFullOneClickLoginRequest(this: BackendRouteContext): boolean {
  const appEnv = String(process.env.APP_ENV ?? "")
    .trim()
    .toLowerCase();
  const nodeEnv = String(process.env.NODE_ENV ?? "")
    .trim()
    .toLowerCase();
  return (
    appEnv === "dev" ||
    appEnv === "development" ||
    appEnv === "local" ||
    nodeEnv === "development"
  );
}
