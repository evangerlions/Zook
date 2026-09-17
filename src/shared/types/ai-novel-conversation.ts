export interface AiNovelConversationTool {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}

export type AiNovelConversationOutcome = "success" | "failure";

export interface AiNovelConversationRecord {
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
  outcome?: AiNovelConversationOutcome;
  errorCode?: string;
  errorMessage?: string;
  serverCompacted?: boolean;
  systemPrompt?: string;
  tools?: AiNovelConversationTool[];
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
  items: AiNovelConversationRecord[];
}
