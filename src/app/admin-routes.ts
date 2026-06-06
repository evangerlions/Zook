import type { HttpRequest, HttpResponse } from "../shared/types.ts";
import type { BackendRouteContext } from "./backend-route-context.ts";
import { tryHandleAdminAppSettingsRoutes } from "./admin-app-settings-routes.ts";
import { tryHandleAdminAuthGetuiRoutes } from "./admin-auth-getui-routes.ts";
import { tryHandleAdminCoreRoutes } from "./admin-core-routes.ts";
import { tryHandleAdminEmailSmsRoutes } from "./admin-email-sms-routes.ts";
import { tryHandleAdminLlmRoutes } from "./admin-llm-routes.ts";
import { tryHandleAdminRemoteLogRoutes } from "./admin-remote-log-routes.ts";
import { tryHandleAdminSecurityRoutes } from "./admin-security-routes.ts";

const adminRouteHandlers = [
  tryHandleAdminCoreRoutes,
  tryHandleAdminEmailSmsRoutes,
  tryHandleAdminAuthGetuiRoutes,
  tryHandleAdminSecurityRoutes,
  tryHandleAdminLlmRoutes,
  tryHandleAdminAppSettingsRoutes,
  tryHandleAdminRemoteLogRoutes,
];

export async function tryHandleAdminRoutes(
  this: BackendRouteContext,
  request: HttpRequest,
): Promise<HttpResponse<unknown> | undefined> {
  for (const handler of adminRouteHandlers) {
    const response = await handler.call(this, request);
    if (response) {
      return response;
    }
  }
  return undefined;
}
