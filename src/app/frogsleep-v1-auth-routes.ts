import type { HttpRequest, HttpResponse } from "../shared/types.ts";
import type { BackendRouteContext } from "./backend-route-context.ts";
import { FROGSLEEP_APP_ID } from "../modules/frogsleep/frogsleep-app.ts";
import { conflict } from "../shared/errors.ts";
import {
  asBody,
  authenticateFrogSleepRequest,
  frogSleepOk,
  requireStringField,
  stringField,
  toFrogSleepAuthPayload,
  toFrogSleepMePayload,
} from "./frogsleep-v1-common.ts";

export async function handleFrogSleepPasswordRegister(
  context: BackendRouteContext,
  request: HttpRequest,
  options: { sendCodeWhenMissing?: boolean } = {},
): Promise<HttpResponse<unknown>> {
  const body = asBody(request);
  const email = requireStringField(body, "email");
  const emailCode = stringField(body, "email_code", "emailCode", "code");
  if (options.sendCodeWhenMissing && !emailCode) {
    const emailContext = await context.requestEmailContextService.resolve(request);
    const result = await context.authService.registerEmailCode({
      appId: FROGSLEEP_APP_ID,
      email,
      ipAddress: request.ipAddress ?? "unknown",
      locale: emailContext.locale,
      region: emailContext.region,
    });
    return frogSleepOk(context, {
      ...result,
      verification_id: email,
      expires_at: new Date(Date.now() + result.expiresInSeconds * 1000).toISOString(),
    }, request.requestId as string);
  }

  const session = await context.authService.register({
    appId: FROGSLEEP_APP_ID,
    email,
    password: requireStringField(body, "password"),
    emailCode: emailCode ?? requireStringField(body, "email_code", "emailCode", "code"),
    ipAddress: request.ipAddress ?? "unknown",
  });
  return frogSleepOk(context, await toFrogSleepAuthPayload(context, session), request.requestId as string);
}

export async function handleFrogSleepPasswordLogin(
  context: BackendRouteContext,
  request: HttpRequest,
): Promise<HttpResponse<unknown>> {
  const body = asBody(request);
  const account = requireStringField(body, "account", "identifier", "email");
  const session = await context.authService.login({
    appId: FROGSLEEP_APP_ID,
    account,
    password: requireStringField(body, "password"),
  });
  return frogSleepOk(context, await toFrogSleepAuthPayload(context, session), request.requestId as string);
}

export async function handleFrogSleepEmailCode(
  context: BackendRouteContext,
  request: HttpRequest,
): Promise<HttpResponse<unknown>> {
  const body = asBody(request);
  const emailContext = await context.requestEmailContextService.resolve(request);
  const email = requireStringField(body, "email", "verification_id", "verificationId");
  const result = await context.authService.loginEmailCode({
    appId: FROGSLEEP_APP_ID,
    email,
    ipAddress: request.ipAddress ?? "unknown",
    locale: emailContext.locale,
    region: emailContext.region,
  });
  return frogSleepOk(context, {
    ...result,
    verification_id: email,
    expires_at: new Date(Date.now() + result.expiresInSeconds * 1000).toISOString(),
  }, request.requestId as string);
}

export async function handleFrogSleepEmailChangeCode(
  context: BackendRouteContext,
  request: HttpRequest,
): Promise<HttpResponse<unknown>> {
  await authenticateFrogSleepRequest(context, request);
  const body = asBody(request);
  const emailContext = await context.requestEmailContextService.resolve(request);
  const email = requireStringField(body, "email", "verification_id", "verificationId");
  const result = await context.authService.emailChangeCode({
    appId: FROGSLEEP_APP_ID,
    email,
    ipAddress: request.ipAddress ?? "unknown",
    locale: emailContext.locale,
    region: emailContext.region,
  });
  return frogSleepOk(context, {
    ...result,
    verification_id: email,
    expires_at: new Date(Date.now() + result.expiresInSeconds * 1000).toISOString(),
  }, request.requestId as string);
}

export async function handleFrogSleepEmailLogin(
  context: BackendRouteContext,
  request: HttpRequest,
): Promise<HttpResponse<unknown>> {
  const body = asBody(request);
  const result = await context.authService.loginWithEmailCode({
    appId: FROGSLEEP_APP_ID,
    email: requireStringField(body, "email", "verification_id", "verificationId"),
    emailCode: requireStringField(body, "email_code", "emailCode", "code"),
    ipAddress: request.ipAddress ?? "unknown",
  });
  return frogSleepOk(context, await toFrogSleepAuthPayload(context, result.session), request.requestId as string);
}

export async function handleFrogSleepEmailBindOrChange(
  context: BackendRouteContext,
  request: HttpRequest,
): Promise<HttpResponse<unknown>> {
  const auth = await authenticateFrogSleepRequest(context, request);
  const body = asBody(request);
  const email = requireStringField(body, "email").trim().toLowerCase();
  const existing = await context.database.findUserByAccount(email);
  if (existing && existing.id !== auth.userId) {
    conflict("AUTH_ACCOUNT_ALREADY_EXISTS", "The email is already bound to another account.");
  }

  await context.authService.verifyEmailChangeCode({
    appId: FROGSLEEP_APP_ID,
    email,
    emailCode: requireStringField(body, "email_code", "emailCode", "code"),
    ipAddress: request.ipAddress ?? "unknown",
  });
  await context.database.updateUserEmail(auth.userId, email);
  return frogSleepOk(context, await toFrogSleepMePayload(context, auth.userId), request.requestId as string);
}

export async function handleFrogSleepPasswordResetRequest(
  context: BackendRouteContext,
  request: HttpRequest,
): Promise<HttpResponse<unknown>> {
  const body = asBody(request);
  const emailContext = await context.requestEmailContextService.resolve(request);
  const email = requireStringField(body, "email", "verification_id", "verificationId");
  const result = await context.authService.sendPasswordCode({
    appId: FROGSLEEP_APP_ID,
    email,
    ipAddress: request.ipAddress ?? "unknown",
    locale: emailContext.locale,
    region: emailContext.region,
  });
  return frogSleepOk(context, {
    ...result,
    verification_id: email,
    expires_at: new Date(Date.now() + result.expiresInSeconds * 1000).toISOString(),
  }, request.requestId as string);
}

export async function handleFrogSleepPasswordResetConfirm(
  context: BackendRouteContext,
  request: HttpRequest,
): Promise<HttpResponse<unknown>> {
  const body = asBody(request);
  const session = await context.authService.resetPassword({
    appId: FROGSLEEP_APP_ID,
    email: requireStringField(body, "email", "verification_id", "verificationId"),
    emailCode: requireStringField(body, "email_code", "emailCode", "code"),
    password: requireStringField(body, "password", "new_password", "newPassword"),
    ipAddress: request.ipAddress ?? "unknown",
  });
  return frogSleepOk(context, await toFrogSleepAuthPayload(context, session), request.requestId as string);
}

export async function handleFrogSleepChangePassword(
  context: BackendRouteContext,
  request: HttpRequest,
): Promise<HttpResponse<unknown>> {
  const auth = await authenticateFrogSleepRequest(context, request);
  const body = asBody(request);
  const session = await context.authService.changePassword({
    appId: FROGSLEEP_APP_ID,
    userId: auth.userId,
    currentPassword: requireStringField(body, "current_password", "currentPassword"),
    newPassword: requireStringField(body, "new_password", "newPassword", "password"),
  });
  return frogSleepOk(context, await toFrogSleepAuthPayload(context, session), request.requestId as string);
}

export async function handleFrogSleepRefresh(
  context: BackendRouteContext,
  request: HttpRequest,
): Promise<HttpResponse<unknown>> {
  const body = asBody(request);
  const session = await context.authService.refresh({
    appId: FROGSLEEP_APP_ID,
    refreshToken: stringField(body, "refresh_token", "refreshToken"),
    cookieRefreshToken: request.cookies?.refreshToken,
  });
  return frogSleepOk(context, await toFrogSleepAuthPayload(context, session), request.requestId as string);
}

export async function handleFrogSleepLogout(
  context: BackendRouteContext,
  request: HttpRequest,
): Promise<HttpResponse<unknown>> {
  const auth = await authenticateFrogSleepRequest(context, request);
  const body = asBody(request);
  const revoked = await context.authService.logout(
    {
      appId: FROGSLEEP_APP_ID,
      scope: stringField(body, "scope") === "all" ? "all" : "current",
      refreshToken: stringField(body, "refresh_token", "refreshToken"),
      cookieRefreshToken: request.cookies?.refreshToken,
    },
    auth,
  );
  return frogSleepOk(context, { status: "ok", revoked }, request.requestId as string, {
    "Set-Cookie": context.authService.buildClearRefreshCookie(),
  });
}

export async function handleFrogSleepMe(
  context: BackendRouteContext,
  request: HttpRequest,
): Promise<HttpResponse<unknown>> {
  const auth = await authenticateFrogSleepRequest(context, request);
  return frogSleepOk(context, await toFrogSleepMePayload(context, auth.userId), request.requestId as string);
}

export async function handleFrogSleepDeleteAccount(
  context: BackendRouteContext,
  request: HttpRequest,
): Promise<HttpResponse<unknown>> {
  const auth = await authenticateFrogSleepRequest(context, request);
  const body = asBody(request);
  const result = await context.authService.deleteCurrentAppAccount({
    appId: FROGSLEEP_APP_ID,
    userId: auth.userId,
    confirmation: requireStringField(body, "confirmation"),
  });
  return frogSleepOk(context, { status: "deleted", ...result }, request.requestId as string);
}

export async function handleFrogSleepRegisterDevice(
  context: BackendRouteContext,
  request: HttpRequest,
): Promise<HttpResponse<unknown>> {
  const auth = await authenticateFrogSleepRequest(context, request);
  const body = asBody(request);
  const now = new Date().toISOString();
  const device = await context.database.upsertFrogSleepDevice({
    id: stringField(body, "device_id", "deviceId") ?? `frogsleep_device_${auth.userId}_${Date.now()}`,
    appId: FROGSLEEP_APP_ID,
    userId: auth.userId,
    platform: (stringField(body, "platform") ?? "ios") as "ios" | "android" | "web",
    pushToken: requireStringField(body, "push_token", "pushToken", "token"),
    appVersion: stringField(body, "app_version", "appVersion"),
    timezone: stringField(body, "timezone"),
    pushEnabled: true,
    createdAt: now,
    updatedAt: now,
  });
  return frogSleepOk(context, { device }, request.requestId as string);
}

export async function handleFrogSleepDeleteDevice(
  context: BackendRouteContext,
  request: HttpRequest,
  deviceId: string,
): Promise<HttpResponse<unknown>> {
  const auth = await authenticateFrogSleepRequest(context, request);
  const deleted = await context.database.deleteFrogSleepDevice(FROGSLEEP_APP_ID, auth.userId, deviceId);
  return frogSleepOk(context, { status: deleted ? "deleted" : "not_found", deleted: Boolean(deleted), device: deleted }, request.requestId as string);
}
