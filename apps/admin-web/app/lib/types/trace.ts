export type AiNovelTraceKind =
  | "kickoff"
  | "import_book"
  | "imported_kickoff"
  | "writing"
  | "history_qa"
  | "advance_chapter";

export type AiNovelTraceStatus =
  | "running"
  | "completed"
  | "failed"
  | "cancelled";

export interface AiNovelDebugTraceManifest {
  sessionId: string;
  uid?: string;
  kind: AiNovelTraceKind;
  status: AiNovelTraceStatus;
  bookId?: string;
  chapterId?: string;
  title?: string;
  captureCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface AiNovelDebugTraceCapture {
  capturedAt: string;
  status: AiNovelTraceStatus;
  trace: Record<string, unknown>;
}

export interface AiNovelDebugTraceSession {
  manifest: AiNovelDebugTraceManifest;
  captures: AiNovelDebugTraceCapture[];
}

export interface AiNovelTraceMessage {
  role: string;
  content: unknown;
  [key: string]: unknown;
}

export interface AiNovelTraceDiffLine {
  kind: "same" | "added" | "removed" | "meta";
  text: string;
}

export interface AiNovelTraceRequest {
  id: string;
  index: number;
  sceneKey?: string;
  status: string;
  capturedAt: string;
  messages: AiNovelTraceMessage[];
  events: Record<string, unknown>[];
  model?: string;
  transport?: string;
  tokenCount?: number;
  durationMs?: number;
  toolNames: string[];
  raw: Record<string, unknown>;
}

export interface AiNovelTraceTurn {
  id: string;
  index: number;
  status: string;
  capturedAt: string;
  userMessage?: AiNovelTraceMessage;
  messages: AiNovelTraceMessage[];
  requests: AiNovelTraceRequest[];
  model?: string;
  transport?: string;
  tokenCount?: number;
  durationMs?: number;
  toolNames: string[];
  contextDiff: AiNovelTraceDiffLine[];
  raw: Record<string, unknown>;
}

export interface AiNovelDebugTraceViewModel {
  turns: AiNovelTraceTurn[];
}

export interface AdminAiNovelDebugTraceListDocument {
  items: AiNovelDebugTraceManifest[];
}

export interface AdminAiNovelDebugTraceDocument {
  session: AiNovelDebugTraceSession;
  sessions: AiNovelDebugTraceManifest[];
  viewModel: AiNovelDebugTraceViewModel;
}
