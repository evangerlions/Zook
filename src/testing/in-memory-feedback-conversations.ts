import type { FeedbackAttachmentRecord, FeedbackRecord } from "../shared/types.ts";
import type {
  FeedbackConversationRecord,
  FeedbackConversationStore,
  FeedbackPageBoundary,
  FeedbackReplyRecord,
  FeedbackReplySender,
  FeedbackReplyWrite,
  FeedbackReplyWriteResult,
} from "../infrastructure/database/feedback-conversation-store.ts";

type StoredFeedbackReply = FeedbackReplyRecord & Pick<FeedbackReplyWrite, "submissionKey" | "fingerprint">;

export function toFeedbackConversationRecord(record: FeedbackRecord): FeedbackConversationRecord {
  const state = record as Partial<FeedbackConversationRecord>;
  return {
    ...record,
    conversationUpdatedAt: state.conversationUpdatedAt,
    needsReply: state.needsReply ?? true,
    lastSupportMessage: state.lastSupportMessage ?? 0,
    readSupportMessage: state.readSupportMessage ?? 0,
  };
}

export class InMemoryFeedbackConversationStore implements FeedbackConversationStore {
  private readonly replies: StoredFeedbackReply[] = [];
  private sequence = 0;

  constructor(
    private readonly feedback: () => FeedbackRecord[],
    private readonly attachments: () => FeedbackAttachmentRecord[],
  ) {}

  find(appId: string, id: string, userId?: string): FeedbackConversationRecord | undefined {
    const match = this.findParent(appId, id, userId);
    return match ? toFeedbackConversationRecord(structuredClone(match)) : undefined;
  }

  list(appId: string, userId: string, limit: number, before?: FeedbackPageBoundary): FeedbackConversationRecord[] {
    const activity = (record: FeedbackConversationRecord) => record.conversationUpdatedAt ?? record.createdAt;
    const rows = this.feedback().filter(row => row.appId === appId && row.userId === userId).map(toFeedbackConversationRecord)
      .filter(row => !before || activity(row) < before.time || (activity(row) === before.time && row.id < before.id))
      .sort((a, b) => activity(b).localeCompare(activity(a)) || b.id.localeCompare(a.id));
    return structuredClone(rows.slice(0, limit));
  }

  hasAttachmentStoragePath(appId: string, storagePath: string): boolean {
    return this.attachments().some(row => row.appId === appId && row.storagePath === storagePath);
  }

  hasUnread(appId: string, userId: string): boolean {
    return this.feedback().some(record => {
      if (record.appId !== appId || record.userId !== userId) return false;
      const { lastSupportMessage, readSupportMessage } = toFeedbackConversationRecord(record);
      return lastSupportMessage > readSupportMessage;
    });
  }

  listReplies(id: string, limit: number, before?: number): FeedbackReplyRecord[] {
    return structuredClone(this.replies
      .filter(reply => reply.feedbackId === id && (before === undefined || reply.sequence < before))
      .sort((a, b) => b.sequence - a.sequence).slice(0, limit));
  }

  findSubmission(id: string, sender: FeedbackReplySender, submissionKey: string): { id: string; fingerprint: string } | undefined {
    const reply = this.replies.find(row => row.feedbackId === id && row.sender === sender && row.submissionKey === submissionKey);
    return reply ? { id: reply.id, fingerprint: reply.fingerprint } : undefined;
  }

  listReplyAttachments(replyIds: string[]): FeedbackAttachmentRecord[] {
    const ids = new Set(replyIds);
    return structuredClone(this.attachments().filter(file => file.replyId !== undefined && ids.has(file.replyId))
      .sort((a, b) => a.id.localeCompare(b.id)));
  }

  append(
    appId: string,
    ownerId: string,
    reply: FeedbackReplyWrite,
    attachments: FeedbackAttachmentRecord[],
    close: boolean,
  ): FeedbackReplyWriteResult {
    const parent = this.findParent(appId, reply.feedbackId, ownerId);
    if (!parent) return { kind: "missing" };
    const existing = this.replies.find(row => row.feedbackId === reply.feedbackId && row.sender === reply.sender && row.submissionKey === reply.submissionKey);
    if (existing) return existing.fingerprint === reply.fingerprint ? { kind: "replayed", id: existing.id } : { kind: "conflict" };
    const saved = { ...reply, sequence: ++this.sequence };
    this.replies.push(saved);
    this.attachments().push(...structuredClone(attachments));

    const activity = parent.conversationUpdatedAt ?? parent.createdAt;
    parent.conversationUpdatedAt = activity > reply.createdAt ? activity : reply.createdAt;
    if (reply.createdAt > parent.updatedAt) parent.updatedAt = reply.createdAt;
    parent.needsReply = reply.sender === "user";
    if (reply.sender === "support") parent.lastSupportMessage = saved.sequence;
    if (close) parent.status = "done";
    else if (parent.status !== "done") parent.status = "doing";
    return { kind: "saved", id: saved.id };
  }

  markRead(appId: string, id: string, ownerId: string, messageId: string): boolean {
    const parent = this.findParent(appId, id, ownerId);
    const reply = this.replies.find(row => row.feedbackId === id && row.id === messageId && row.sender === "support");
    if (!parent || !reply) return false;
    parent.readSupportMessage = Math.max(parent.readSupportMessage ?? 0, reply.sequence);
    return true;
  }

  deleteReplies(feedbackIds: string[]): void {
    const ids = new Set(feedbackIds);
    for (let index = this.replies.length - 1; index >= 0; index -= 1) {
      if (ids.has(this.replies[index]!.feedbackId)) this.replies.splice(index, 1);
    }
  }

  private findParent(appId: string, id: string, userId: string | undefined): (FeedbackRecord & Partial<FeedbackConversationRecord>) | undefined {
    return this.feedback().find(row => row.appId === appId && row.id === id && (userId === undefined || row.userId === userId));
  }
}
