export interface AdminAiNovelConversationRecord {
  id: string;
  appId: "ai_novel";
  userId: string;
  did?: string;
  requestId: string;
  messageId?: string;
  sessionId?: string;
  turnId?: string;
  sceneKey: string;
  userText: string;
  assistantText: string;
  createdAt: string;
}

export interface AdminAiNovelConversationRecordDocument {
  app: "ai_novel";
  query: {
    uid?: string;
    did?: string;
  };
  page: number;
  pageSize: number;
  hasMore: boolean;
  items: AdminAiNovelConversationRecord[];
}
