import { adminPath, requestJson } from "./admin-api-client.ts";
import { cleanQuery } from "./admin-api-query.ts";
import type {
  AdminFeedbackAttachmentContentDocument,
  AdminFeedbackListDocument,
  AdminFeedbackReply,
  AdminFeedbackStatusUpdateDocument,
  AdminFeedbackThread,
  FeedbackStatus,
} from "./types/feedback.ts";

const root = adminPath("/apps/ai_novel/feedback");

function feedbackPath(feedbackId: string) {
  return `${root}/${encodeURIComponent(feedbackId)}`;
}

function querySuffix(params: Record<string, string | undefined>) {
  const query = new URLSearchParams(cleanQuery(params)).toString();
  return query ? `?${query}` : "";
}

export const adminFeedbackApi = {
  getAiNovelFeedback(input: {
    limit?: number;
    status?: FeedbackStatus | "all";
    needsReply?: boolean;
    signal?: AbortSignal;
  } = {}) {
    const suffix = querySuffix({
      limit: input.limit ? String(input.limit) : undefined,
      status: input.status === "all" ? undefined : input.status,
      needsReply: input.needsReply ? "true" : undefined,
    });
    return requestJson<AdminFeedbackListDocument>(`${root}${suffix}`, { signal: input.signal });
  },
  getAiNovelFeedbackThread(feedbackId: string, cursor?: string, signal?: AbortSignal) {
    return requestJson<AdminFeedbackThread>(
      `${feedbackPath(feedbackId)}${querySuffix({ cursor })}`, { signal },
    );
  },
  replyToAiNovelFeedback(feedbackId: string, body: AdminFeedbackReply) {
    return requestJson<{ id: string }>(`${feedbackPath(feedbackId)}/messages`, { method: "POST", body });
  },
  updateAiNovelFeedbackStatus(feedbackId: string, status: FeedbackStatus) {
    return requestJson<AdminFeedbackStatusUpdateDocument>(`${feedbackPath(feedbackId)}/status`, {
      method: "PATCH", body: { status },
    });
  },
  getAiNovelFeedbackAttachment(feedbackId: string, attachmentId: string, signal?: AbortSignal) {
    return requestJson<AdminFeedbackAttachmentContentDocument>(
      `${feedbackPath(feedbackId)}/attachments/${encodeURIComponent(attachmentId)}`, { signal },
    );
  },
};
