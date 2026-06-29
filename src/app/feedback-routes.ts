import { ApplicationError } from "../shared/errors.ts";
import type { HttpRequest, HttpResponse } from "../shared/types.ts";
import { getHeader } from "../shared/utils.ts";
import type { BackendRouteContext } from "./backend-route-context.ts";

function firstForwardedIp(value?: string): string | undefined {
  return value?.split(",").map((item) => item.trim()).find(Boolean);
}

export async function tryHandleFeedbackRoutes(
  this: BackendRouteContext,
  request: HttpRequest,
): Promise<HttpResponse<unknown> | undefined> {
  if (request.method === "POST" && request.path === "/api/v1/ai_novel/feedback") {
    return await handleSubmitAiNovelFeedback.call(this, request);
  }

  if (request.method === "GET" && request.path === "/api/v1/admin/apps/ai_novel/feedback") {
    return await handleAdminListAiNovelFeedback.call(this, request);
  }

  const statusMatch = request.path.match(
    /^\/api\/v1\/admin\/apps\/ai_novel\/feedback\/([^/]+)\/status$/,
  );
  if (request.method === "PATCH" && statusMatch) {
    return await handleAdminUpdateAiNovelFeedbackStatus.call(
      this,
      request,
      decodeURIComponent(statusMatch[1] ?? ""),
    );
  }

  const attachmentMatch = request.path.match(
    /^\/api\/v1\/admin\/apps\/ai_novel\/feedback\/([^/]+)\/attachments\/([^/]+)$/,
  );
  if (request.method === "GET" && attachmentMatch) {
    return await handleAdminGetAiNovelFeedbackAttachment.call(
      this,
      request,
      decodeURIComponent(attachmentMatch[1] ?? ""),
      decodeURIComponent(attachmentMatch[2] ?? ""),
    );
  }

  return undefined;
}

async function handleSubmitAiNovelFeedback(
  this: BackendRouteContext,
  request: HttpRequest,
): Promise<HttpResponse<unknown>> {
  const auth = await this.authenticate(request);
  this.appAccessGuard.assertScope("ai_novel", auth.appId);
  const body = this.validationPipe.asObject(request.body);
  const result = await this.feedbackService.submit({
    auth,
    message: body.message,
    attachments: body.attachments,
    ipAddress: firstForwardedIp(getHeader(request.headers, "x-forwarded-for")) ?? request.ipAddress,
    platform: this.validationPipe.optionalString(body, "platform") ?? getHeader(request.headers, "x-platform"),
    appVersion: this.validationPipe.optionalString(body, "appVersion") ?? getHeader(request.headers, "x-app-version"),
    locale: this.validationPipe.optionalString(body, "locale") ?? getHeader(request.headers, "x-app-locale"),
    userAgent: getHeader(request.headers, "user-agent"),
    metadata: body.metadata && typeof body.metadata === "object" && !Array.isArray(body.metadata)
      ? body.metadata as Record<string, unknown>
      : undefined,
  });

  await this.auditInterceptor.record({
    appId: auth.appId,
    actorUserId: auth.userId,
    action: "feedback.submit",
    resourceType: "feedback",
    resourceId: result.id,
    resourceOwnerUserId: auth.userId,
    payload: {
      attachmentCount: result.attachmentCount,
    },
  });
  return this.ok(result, request.requestId as string);
}

async function handleAdminListAiNovelFeedback(
  this: BackendRouteContext,
  request: HttpRequest,
): Promise<HttpResponse<unknown>> {
  this.requireAdminSession(request);
  const result = await this.feedbackService.listAdminFeedback({
    limit: request.query?.limit,
    status: request.query?.status,
  });
  return this.ok(result, request.requestId as string);
}

async function handleAdminUpdateAiNovelFeedbackStatus(
  this: BackendRouteContext,
  request: HttpRequest,
  feedbackId: string,
): Promise<HttpResponse<unknown>> {
  this.requireAdminSession(request);
  const body = this.validationPipe.asObject(request.body);
  const result = await this.feedbackService.updateAdminFeedbackStatus(feedbackId, body.status);
  return this.ok(result, request.requestId as string);
}

async function handleAdminGetAiNovelFeedbackAttachment(
  this: BackendRouteContext,
  request: HttpRequest,
  feedbackId: string,
  attachmentId: string,
): Promise<HttpResponse<unknown>> {
  this.requireAdminSession(request);
  if (!feedbackId || !attachmentId) {
    throw new ApplicationError(400, "REQ_INVALID_BODY", "Feedback attachment path is invalid.");
  }
  const result = await this.feedbackService.readAdminAttachment(feedbackId, attachmentId);
  return this.ok(result, request.requestId as string);
}
