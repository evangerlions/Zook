import { ApplicationError, isApplicationError } from "../shared/errors.ts";
import type { HttpRequest, HttpResponse } from "../shared/types.ts";
import { PublicContractValidator } from "../generated/openapi/public-contract-validator.ts";
import type { BackendRouteContext } from "./backend-route-context.ts";
export async function tryHandleFileNotificationRoutes(
  this: BackendRouteContext,
  request: HttpRequest,
): Promise<HttpResponse<unknown> | undefined> {
  if (request.method === "POST" && request.path === "/api/v1/files/presign") return await handleFilePresign.call(this, request);
  if (request.method === "POST" && request.path === "/api/v1/files/confirm") return await handleFileConfirm.call(this, request);
  if (request.method === "POST" && request.path === "/api/v1/notifications/send") return await handleNotification.call(this, request);
  return undefined;
}

export async function handleFilePresign(this: BackendRouteContext, 
  request: HttpRequest,
): Promise<HttpResponse<unknown>> {
  const auth = await this.authenticate(request);
  const body = this.validationPipe.asObject(request.body);
  const validated = this.requireValidPublicContract(
    PublicContractValidator.validateFilePresign(body),
    request,
  );
  const appId = validated.appId.trim();
  this.appAccessGuard.assertScope(appId, auth.appId);

  const result = await this.storageService.presignUpload({
    appId: auth.appId,
    ownerUserId: auth.userId,
    fileName: validated.fileName.trim(),
    mimeType: validated.mimeType.trim(),
    sizeBytes: validated.sizeBytes,
  });

  return this.ok(result, request.requestId as string);
}

export async function handleFileConfirm(this: BackendRouteContext, 
  request: HttpRequest,
): Promise<HttpResponse<unknown>> {
  const auth = await this.authenticate(request);
  const body = this.validationPipe.asObject(request.body);
  const validated = this.requireValidPublicContract(
    PublicContractValidator.validateFileConfirm(body),
    request,
  );
  const appId = validated.appId.trim();
  this.appAccessGuard.assertScope(appId, auth.appId);

  const result = await this.storageService.confirmUpload({
    appId: auth.appId,
    ownerUserId: auth.userId,
    storageKey: validated.storageKey.trim(),
    mimeType: validated.mimeType.trim(),
    sizeBytes: validated.sizeBytes,
  });

  await this.auditInterceptor.record({
    appId: auth.appId,
    actorUserId: auth.userId,
    action: "file.confirm",
    resourceType: "file",
    resourceId: result.storageKey,
    resourceOwnerUserId: auth.userId,
    payload: {
      mimeType: validated.mimeType,
    },
  });

  return this.ok(result, request.requestId as string);
}

export async function handleNotification(this: BackendRouteContext, 
  request: HttpRequest,
): Promise<HttpResponse<unknown>> {
  const auth = await this.authenticate(request);
  const body = this.validationPipe.asObject(request.body);
  const validated = this.requireValidPublicContract(
    PublicContractValidator.validateNotificationSend(body),
    request,
  );
  const appId = validated.appId.trim();
  this.appAccessGuard.assertScope(appId, auth.appId);
  await this.rbacGuard.assertPermission(
    auth.appId,
    auth.userId,
    "notification:send",
  );

  const result = await this.notificationService.queueNotification({
    appId: auth.appId,
    recipientUserId: validated.recipientUserId.trim(),
    channel: validated.channel as "email" | "sms" | "push",
    payload: (validated.payload as Record<string, unknown> | undefined) ?? {},
  });

  return this.ok(result, request.requestId as string);
}
