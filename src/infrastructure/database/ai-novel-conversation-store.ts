import type { AiNovelConversationRecord } from "../../shared/types.ts";

export interface AiNovelConversationStore {
  insert(record: AiNovelConversationRecord): Promise<boolean> | boolean;
  list(filter: {
    appId: "ai_novel";
    userId?: string;
    did?: string;
    offset?: number;
    limit?: number;
  }): Promise<AiNovelConversationRecord[]> | AiNovelConversationRecord[];
  trim(input: {
    appId: "ai_novel";
    userId: string;
    highWaterMark: number;
    retainCount: number;
  }): Promise<number> | number;
}
