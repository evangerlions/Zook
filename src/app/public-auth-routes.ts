import type { HttpRequest, HttpResponse } from "../shared/types.ts";
import type { BackendRouteContext } from "./backend-route-context.ts";
import {
  handleLogin,
  handleLoginEmailCode,
  handleLoginSmsCode,
  handleLoginWithEmailCode,
  handleLoginWithOneClick,
  handleLoginWithSmsCode,
  handleOneClickLoginStatus,
  handleRegisterEmailCode,
} from "./auth-login-routes.ts";
import {
  handleChangePassword,
  handleResetPassword,
  handleResetPasswordBySms,
  handleSendPasswordCode,
  handleSendPasswordSmsCode,
  handleSetPassword,
} from "./auth-password-routes.ts";
import {
  handleRegister,
  handleRegisterBySms,
  handleRegisterSmsCode,
} from "./auth-registration-routes.ts";
import {
  handleConfirmQrLogin,
  handleCreateQrLogin,
  handleDeleteCurrentAppAccount,
  handleGetCurrentUser,
  handleLogout,
  handlePollQrLogin,
  handleRefresh,
} from "./auth-session-routes.ts";
import {
  handleAnalyticsBatch,
  handleMetricsOverview,
  handleMetricsPages,
} from "./analytics-metrics-routes.ts";

export async function tryHandlePublicAuthRoutes(
  this: BackendRouteContext,
  request: HttpRequest,
): Promise<HttpResponse<unknown> | undefined> {
  if (request.method === "POST" && request.path === "/api/v1/auth/login") {
    return await handleLogin.call(this, request);
  }
  if (request.method === "POST" && request.path === "/api/v1/auth/login/email-code") {
    return await handleLoginEmailCode.call(this, request);
  }
  if (request.method === "POST" && request.path === "/api/v1/auth/login/sms-code") {
    return await handleLoginSmsCode.call(this, request);
  }
  if (request.method === "POST" && request.path === "/api/v1/auth/login/email") {
    return await handleLoginWithEmailCode.call(this, request);
  }
  if (request.method === "POST" && request.path === "/api/v1/auth/login/sms") {
    return await handleLoginWithSmsCode.call(this, request);
  }
  if (request.method === "GET" && request.path === "/api/v1/auth/login/one-click/status") {
    return await handleOneClickLoginStatus.call(this, request);
  }
  if (request.method === "POST" && request.path === "/api/v1/auth/login/one-click") {
    return await handleLoginWithOneClick.call(this, request);
  }
  if (request.method === "POST" && request.path === "/api/v1/auth/password/email-code") {
    return await handleSendPasswordCode.call(this, request);
  }
  if (request.method === "POST" && request.path === "/api/v1/auth/password/sms-code") {
    return await handleSendPasswordSmsCode.call(this, request);
  }
  if (request.method === "POST" && request.path === "/api/v1/auth/password/reset") {
    return await handleResetPassword.call(this, request);
  }
  if (request.method === "POST" && request.path === "/api/v1/auth/password/reset-by-sms") {
    return await handleResetPasswordBySms.call(this, request);
  }
  if (request.method === "POST" && request.path === "/api/v1/auth/password/change") {
    return await handleChangePassword.call(this, request);
  }
  if (request.method === "POST" && request.path === "/api/v1/auth/password/set") {
    return await handleSetPassword.call(this, request);
  }
  if (request.method === "POST" && request.path === "/api/v1/auth/register/email-code") {
    return await handleRegisterEmailCode.call(this, request);
  }
  if (request.method === "POST" && request.path === "/api/v1/auth/register/sms-code") {
    return await handleRegisterSmsCode.call(this, request);
  }
  if (request.method === "POST" && request.path === "/api/v1/auth/register") {
    return await handleRegister.call(this, request);
  }
  if (request.method === "POST" && request.path === "/api/v1/auth/register/sms") {
    return await handleRegisterBySms.call(this, request);
  }
  if (request.method === "POST" && request.path === "/api/v1/auth/qr-logins") {
    return await handleCreateQrLogin.call(this, request);
  }
  const qrLoginConfirmMatch = request.path.match(/^\/api\/v1\/auth\/qr-logins\/([^/]+)\/confirm$/);
  if (request.method === "POST" && qrLoginConfirmMatch) {
    return await handleConfirmQrLogin.call(this, request, decodeURIComponent(qrLoginConfirmMatch[1] as string));
  }
  const qrLoginPollMatch = request.path.match(/^\/api\/v1\/auth\/qr-logins\/([^/]+)$/);
  if (request.method === "GET" && qrLoginPollMatch) {
    return await handlePollQrLogin.call(this, request, decodeURIComponent(qrLoginPollMatch[1] as string));
  }
  if (request.method === "POST" && request.path === "/api/v1/auth/refresh") {
    return await handleRefresh.call(this, request);
  }
  if (request.method === "POST" && request.path === "/api/v1/auth/logout") {
    return await handleLogout.call(this, request);
  }
  if (request.method === "POST" && request.path === "/api/v1/users/me/delete") {
    return await handleDeleteCurrentAppAccount.call(this, request);
  }
  if (request.method === "GET" && request.path === "/api/v1/users/me") {
    return await handleGetCurrentUser.call(this, request);
  }
  if (request.method === "POST" && request.path === "/api/v1/analytics/events/batch") {
    return await handleAnalyticsBatch.call(this, request);
  }
  if (request.method === "GET" && request.path === "/api/v1/admin/metrics/overview") {
    return await handleMetricsOverview.call(this, request);
  }
  if (request.method === "GET" && request.path === "/api/v1/admin/metrics/pages") {
    return await handleMetricsPages.call(this, request);
  }
  return undefined;
}
