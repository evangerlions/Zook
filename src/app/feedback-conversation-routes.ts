import type { AuthContext, HttpRequest, HttpResponse } from "../shared/types.ts";
import { badRequest } from "../shared/errors.ts";
import type { BackendRouteContext } from "./backend-route-context.ts";

const USER_FEEDBACK = "/api/v1/ai_novel/feedback";
const ADMIN_FEEDBACK = "/api/v1/admin/apps/ai_novel/feedback";

export function privateFeedbackResponse<T>(response: HttpResponse<T>): HttpResponse<T> {
  return { ...response, headers: { ...response.headers, "Cache-Control": "private, no-store" } };
}

function readFeedbackSegment(value: string): string {
  let result: string;
  try {
    result = decodeURIComponent(value);
  } catch {
    badRequest("REQ_INVALID_BODY", "Invalid feedback path.");
  }
  if (!/^[A-Za-z0-9_-]{1,100}$/.test(result)) {
    badRequest("REQ_INVALID_BODY", "Invalid feedback path.");
  }
  return result;
}

export async function tryHandleFeedbackConversationRoutes(
  this: BackendRouteContext,
  request: HttpRequest,
): Promise<HttpResponse<unknown> | undefined> {
  const service = this.feedbackConversationService;
  if (request.method === "GET" && request.path === USER_FEEDBACK) {
    const auth = await this.authenticateProductRequest(request, "ai_novel");
    return privateFeedbackResponse(this.ok(await service.list(auth.userId, request.query?.cursor), request.requestId as string));
  }
  const admin = request.path.startsWith(`${ADMIN_FEEDBACK}/`);
  const root = admin ? ADMIN_FEEDBACK : USER_FEEDBACK;
  if (!request.path.startsWith(`${root}/`)) return undefined;
  const target = request.path.slice(root.length + 1).match(/^([^/]+)(?:\/(messages|read|attachments)(?:\/([^/]+))?)?$/);
  if (!target) return undefined;
  const [, rawId, resource, rawAttachmentId] = target;
  const method = request.method;
  if (method === "GET" && !resource) {
    const id = readFeedbackSegment(rawId!);
    if (admin) this.requireAdminSession(request);
    const auth = admin ? undefined : await this.authenticateProductRequest(request, "ai_novel");
    return privateFeedbackResponse(this.ok(await service.detail(id, auth?.userId, request.query?.cursor), request.requestId as string));
  }
  if (method === "POST" && resource === "messages" && !rawAttachmentId) {
    const id = readFeedbackSegment(rawId!);
    return await sendFeedbackReply.call(this, request, id, admin);
  }
  if (!admin && method === "POST" && resource === "read" && !rawAttachmentId) {
    const id = readFeedbackSegment(rawId!);
    const auth = await this.authenticateProductRequest(request, "ai_novel");
    const body = this.validationPipe.asObject(request.body);
    const messageId = this.validationPipe.requireString(body, "messageId");
    return this.ok(await service.markRead(id, auth.userId, messageId), request.requestId as string);
  }
  if (!admin && method === "GET" && resource === "attachments" && rawAttachmentId) {
    const id = readFeedbackSegment(rawId!);
    const attachmentId = readFeedbackSegment(rawAttachmentId);
    const auth = await this.authenticateProductRequest(request, "ai_novel");
    const result = await service.readAttachment(id, attachmentId, auth.userId);
    return privateFeedbackResponse(this.ok(result, request.requestId as string));
  }
  return undefined;
}

async function sendFeedbackReply(
  this: BackendRouteContext,
  request: HttpRequest,
  feedbackId: string,
  admin: boolean,
): Promise<HttpResponse<unknown>> {
  let auth: AuthContext | undefined;
  const session = admin ? this.requireAdminSession(request) : undefined;
  if (!admin) auth = await this.authenticateProductRequest(request, "ai_novel");

  const body = this.validationPipe.asObject(request.body);
  const writer = auth ? { sender: "user" as const, userId: auth.userId } : { sender: "support" as const };
  const result = await this.feedbackConversationService.send(feedbackId, writer, body);
  if (!result.replayed) {
    await this.recordRouteAudit({
      appId: "ai_novel",
      actorUserId: auth?.userId,
      action: admin ? "feedback.reply.support" : "feedback.reply.user",
      resourceType: "feedback",
      resourceId: feedbackId,
      resourceOwnerUserId: auth?.userId,
      payload: { replyId: result.id, close: admin && body.close === true, adminUser: session?.username },
    });
  }
  return this.ok({ id: result.id }, request.requestId as string);
}
