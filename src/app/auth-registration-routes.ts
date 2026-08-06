import { ApplicationError } from "../shared/errors.ts";
import type { HttpRequest, HttpResponse } from "../shared/types.ts";
import { getHeader, maskSensitiveString } from "../shared/utils.ts";
import { PublicContractValidator } from "../generated/openapi/public-contract-validator.ts";
import type { BackendRouteContext } from "./backend-route-context.ts";

export async function handleRegister(this: BackendRouteContext, 
  request: HttpRequest,
): Promise<HttpResponse<unknown>> {
  const body = this.validationPipe.asObject(request.body);
  const validated = this.requireValidPublicContract(
    PublicContractValidator.validateRegister(body),
    request,
  );
  const appId = this.appContextResolver.resolvePreAuth(request);
  const email = validated.email.trim();
  const password = validated.password;
  const emailCode = validated.emailCode.trim();
  const clientType = this.getClientType(validated);
  const ipAddress = request.ipAddress ?? "unknown";

  try {
    const session = await this.authService.register({
      appId,
      email,
      password,
      emailCode,
      ipAddress,
    });

    await this.auditInterceptor.record({
      appId: session.appId,
      actorUserId: session.userId,
      action: "auth.register",
      resourceType: "user",
      resourceId: session.userId,
      resourceOwnerUserId: session.userId,
      payload: {
        email,
        clientType,
        ipAddress,
      },
    });

    return this.ok(
      await this.toAuthPayload(session, clientType, request),
      request.requestId as string,
      this.buildAuthHeaders(session.refreshToken, clientType),
    );
  } catch (error) {
    await this.auditInterceptor.record({
      appId,
      action: "auth.register",
      resourceType: "user_registration",
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

export async function handleRegisterSmsCode(this: BackendRouteContext, 
  request: HttpRequest,
): Promise<HttpResponse<unknown>> {
  const body = this.validationPipe.asObject(request.body);
  const appId = this.appContextResolver.resolvePreAuth(request);
  const phone = this.validationPipe.requireString(body, "phone");
  const phoneNa = this.validationPipe.optionalString(body, "phoneNa");
  const test = this.validationPipe.optionalBoolean(body, "test");
  const ipAddress = request.ipAddress ?? "unknown";

  try {
    const result = await this.authService.registerSmsCode({
      appId,
      phone,
      phoneNa,
      test,
      ipAddress,
    });

    await this.auditInterceptor.record({
      appId,
      action: "auth.register.sms_code",
      resourceType: "user_registration",
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
      action: "auth.register.sms_code",
      resourceType: "user_registration",
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

export async function handleRegisterBySms(this: BackendRouteContext, 
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
    const session = await this.authService.registerWithSms({
      appId,
      phone,
      phoneNa,
      smsCode,
      ipAddress,
    });

    await this.auditInterceptor.record({
      appId: session.appId,
      actorUserId: session.userId,
      action: "auth.register.sms",
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
      await this.toAuthPayload(session, clientType, request),
      request.requestId as string,
      this.buildAuthHeaders(session.refreshToken, clientType),
    );
  } catch (error) {
    await this.auditInterceptor.record({
      appId,
      action: "auth.register.sms",
      resourceType: "user_registration",
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
