import { ApplicationError } from "../shared/errors.ts";
import type { HttpRequest, HttpResponse } from "../shared/types.ts";
import { PublicContractValidator } from "../generated/openapi/public-contract-validator.ts";
import type { BackendRouteContext } from "./backend-route-context.ts";
export async function tryHandleLogRoutes(
  this: BackendRouteContext,
  request: HttpRequest,
): Promise<HttpResponse<unknown> | undefined> {
  if (request.method === "GET" && request.path === "/api/v1/logs/pull-task") return await handleLogsPullTask.call(this, request);
  if (request.method === "GET" && request.path === "/api/v1/logs/policy") return await handleLogsPolicy.call(this, request);
  if (request.method === "POST" && request.path === "/api/v1/logs/upload") return await handleLogsUpload.call(this, request);
  const logAckMatch = request.path.match(/^\/api\/v1\/logs\/tasks\/([^/]+)\/ack$/);
  if (request.method === "POST" && logAckMatch) return await handleLogsAckNoData.call(this, request, decodeURIComponent(logAckMatch[1]));
  const logFailMatch = request.path.match(/^\/api\/v1\/logs\/tasks\/([^/]+)\/fail$/);
  if (request.method === "POST" && logFailMatch) return await handleLogsFail.call(this, request, decodeURIComponent(logFailMatch[1]));
  return undefined;
}

export async function handleLogsPolicy(this: BackendRouteContext, 
  request: HttpRequest,
): Promise<HttpResponse<LogPolicyResult>> {
  const auth = await this.authenticate(request);
  const result = await this.clientLogUploadService.getPolicy(auth);
  return this.ok(result, request.requestId as string);
}

export async function handleLogsPullTask(this: BackendRouteContext, 
  request: HttpRequest,
): Promise<HttpResponse<LogPullTaskResult>> {
  const auth = await this.authenticate(request);
  const result = await this.clientLogUploadService.getPullTask(
    auth,
    this.requireHeader(request, "x-did"),
  );
  return this.ok(result, request.requestId as string);
}

export async function handleLogsUpload(this: BackendRouteContext, 
  request: HttpRequest,
): Promise<HttpResponse<LogUploadResult>> {
  const auth = await this.authenticate(request);
  const result = await this.clientLogUploadService.upload({
    auth,
    did: this.requireHeader(request, "x-did"),
    taskId: this.requireHeader(request, "x-log-task-id"),
    claimToken: this.requireHeader(request, "x-log-claim-token"),
    keyId: this.requireHeader(request, "x-log-key-id"),
    encryption: this.requireHeader(request, "x-log-enc"),
    nonceBase64: this.requireHeader(request, "x-log-nonce"),
    contentEncoding: this.requireHeader(request, "x-log-content"),
    lineCountReported: this.optionalIntegerHeader(
      request,
      "x-log-line-count",
    ),
    plainBytesReported: this.optionalIntegerHeader(
      request,
      "x-log-plain-bytes",
    ),
    compressedBytesReported: this.optionalIntegerHeader(
      request,
      "x-log-compressed-bytes",
    ),
    body: this.requireBinaryBody(request.body),
  });

  await this.auditInterceptor.record({
    appId: auth.appId,
    actorUserId: auth.userId,
    action: "logs.upload",
    resourceType: "client_log_upload",
    resourceId: result.taskId,
    resourceOwnerUserId: auth.userId,
    payload: {
      acceptedCount: result.acceptedCount,
      rejectedCount: result.rejectedCount,
    },
  });
  return this.ok(result, request.requestId as string);
}

export async function handleLogsAckNoData(this: BackendRouteContext, 
  request: HttpRequest,
  taskId: string,
): Promise<HttpResponse<LogNoDataAckResult>> {
  const auth = await this.authenticate(request);
  const body = this.validationPipe.asObject(request.body);
  const validated = this.requireValidPublicContract(
    PublicContractValidator.validateLogAck(body),
    request,
  );

  const result = await this.clientLogUploadService.acknowledgeNoData({
    auth,
    did: this.requireHeader(request, "x-did"),
    taskId,
    claimToken: validated.claimToken,
  });
  return this.ok(result, request.requestId as string);
}

export async function handleLogsFail(this: BackendRouteContext, 
  request: HttpRequest,
  taskId: string,
): Promise<HttpResponse<LogFailResult>> {
  const auth = await this.authenticate(request);
  const body = this.validationPipe.asObject(request.body);
  const validated = this.requireValidPublicContract(
    PublicContractValidator.validateLogFail(body),
    request,
  );
  const result = await this.clientLogUploadService.fail({
    auth,
    did: this.requireHeader(request, "x-did"),
    taskId,
    claimToken: validated.claimToken,
    failureReason: validated.failureReason?.trim(),
  });

  await this.auditInterceptor.record({
    appId: auth.appId,
    actorUserId: auth.userId,
    action: "logs.fail",
    resourceType: "client_log_upload",
    resourceId: result.taskId,
    resourceOwnerUserId: auth.userId,
    payload: {
      failedAt: result.failedAt,
      failureReason: result.failureReason,
    },
  });
  return this.ok(result, request.requestId as string);
}
