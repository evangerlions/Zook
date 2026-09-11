import type {
  AiNovelDebugTraceManifest,
  AiNovelDebugTraceSession,
} from "./ai-novel-debug-trace.service.ts";
import { renderTraceDetailPage } from "./ai-novel-debug-trace-detail-page.ts";
import { renderTraceSessionListPage } from "./ai-novel-debug-trace-console-page.ts";

export function renderAiNovelDebugTraceConsole(): string {
  return renderTraceSessionListPage();
}

export function renderAiNovelDebugTraceDetail(
  session: AiNovelDebugTraceSession,
  sessions: AiNovelDebugTraceManifest[] = [],
): string {
  return renderTraceDetailPage(session, sessions);
}
