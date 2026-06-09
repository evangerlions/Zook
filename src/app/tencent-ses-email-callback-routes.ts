import type { HttpRequest, HttpResponse, TencentSesEmailCallbackAcceptedDocument } from "../shared/types.ts";
import type { BackendRouteContext } from "./backend-route-context.ts";

const TENCENT_SES_EMAIL_CALLBACK_PATH = "/api/v1/email/tencent/callback";

export async function tryHandleTencentSesEmailCallbackRoutes(
  this: BackendRouteContext,
  request: HttpRequest,
): Promise<HttpResponse<unknown> | undefined> {
  if (request.method === "POST" && request.path === TENCENT_SES_EMAIL_CALLBACK_PATH) {
    return await handleTencentSesEmailCallback.call(this, request);
  }
  return undefined;
}

async function handleTencentSesEmailCallback(
  this: BackendRouteContext,
  request: HttpRequest,
): Promise<HttpResponse<TencentSesEmailCallbackAcceptedDocument>> {
  const callbackToken = typeof request.query?.token === "string" ? request.query.token : undefined;
  const result = await this.tencentSesEmailCallbackService.receiveCallback(
    request.body,
    { callbackToken },
  );
  return this.ok(result, request.requestId as string);
}
