import type { AiNovelConversationStore } from "../infrastructure/database/ai-novel-conversation-store.ts";
import type { AiNovelConversationRecord } from "../shared/types.ts";

export class InMemoryAiNovelConversationStore implements AiNovelConversationStore {
  constructor(
    private readonly readRecords: () => AiNovelConversationRecord[],
    private readonly replaceRecords: (records: AiNovelConversationRecord[]) => void,
  ) {}

  insert(record: AiNovelConversationRecord): boolean {
    const records = this.readRecords();
    if (records.some((item) =>
      item.appId === record.appId &&
      item.userId === record.userId &&
      item.requestId === record.requestId,
    )) {
      return false;
    }
    this.replaceRecords([...records, structuredClone(record)]);
    return true;
  }

  list(filter: {
    appId: "ai_novel";
    userId?: string;
    did?: string;
    offset?: number;
    limit?: number;
  }): AiNovelConversationRecord[] {
    const offset = Math.max(0, Math.floor(filter.offset ?? 0));
    const limit = Math.max(1, Math.min(Math.floor(filter.limit ?? 100), 101));
    return structuredClone(this.readRecords())
      .filter((item) => item.appId === filter.appId)
      .filter((item) => filter.userId ? item.userId === filter.userId : true)
      .filter((item) => filter.did ? item.did === filter.did : true)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id))
      .slice(offset, offset + limit);
  }

  trim(input: {
    appId: "ai_novel";
    userId: string;
    highWaterMark: number;
    retainCount: number;
  }): number {
    const records = this.readRecords();
    const matching = records
      .filter((item) => item.appId === input.appId && item.userId === input.userId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt) || right.id.localeCompare(left.id));
    if (matching.length <= input.highWaterMark) return 0;
    const retained = new Set(matching.slice(0, input.retainCount).map((item) => item.id));
    const kept = records.filter((item) =>
      item.appId !== input.appId ||
      item.userId !== input.userId ||
      retained.has(item.id),
    );
    this.replaceRecords(kept);
    return records.length - kept.length;
  }
}
