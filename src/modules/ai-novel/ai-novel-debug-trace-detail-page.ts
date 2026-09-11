import type {
  AiNovelDebugTraceManifest,
  AiNovelDebugTraceSession,
} from "./ai-novel-debug-trace.service.ts";
import { buildAiNovelDebugTraceViewModel } from "./ai-novel-debug-trace-view-model.ts";
import { renderTraceFilters } from "./ai-novel-debug-trace-console-page.ts";
import {
  renderTraceDataScript,
  renderTraceDetailScript,
} from "./ai-novel-debug-trace-console-scripts.ts";
import { TRACE_CONSOLE_STYLES } from "./ai-novel-debug-trace-console-styles.ts";

export function renderTraceDetailPage(
  session: AiNovelDebugTraceSession,
  sessions: AiNovelDebugTraceManifest[],
): string {
  const data = {
    session,
    sessions,
    viewModel: buildAiNovelDebugTraceViewModel(session),
  };
  const title = escapeHtml(
    session.manifest.title ?? session.manifest.sessionId,
  );
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>AINovel Trace · ${title}</title>
  <style>${TRACE_CONSOLE_STYLES}</style>
</head>
<body>
  <main class="page">
    <header class="page-header">
      <div>
        <div class="eyebrow">Conversation trace</div>
        <h1>${title}</h1>
        <p class="subtitle">${escapeHtml(session.manifest.kind)} · ${escapeHtml(session.manifest.status)} · CID ${escapeHtml(session.manifest.sessionId)}</p>
      </div>
      <div class="meta">UID ${escapeHtml(session.manifest.uid ?? "—")} · ${escapeHtml(session.manifest.updatedAt)}</div>
    </header>
    ${renderTraceFilters()}
    <section class="trace-layout">
      <aside class="trace-pane sessions-pane">
        <header class="pane-header">
          <div class="section-label">Sessions</div>
          <h2 id="session-count">${sessions.length}</h2>
          <div class="meta">One continuous ${escapeHtml(session.manifest.kind)} conversation</div>
        </header>
        <nav id="sessions-list" class="pane-list" aria-label="Trace sessions"></nav>
      </aside>
      <section class="trace-pane turns-pane">
        <header class="pane-header">
          <div class="section-label">Turns</div>
          <h2>Agent turns</h2>
          <div class="meta">One user message plus its tool loop</div>
          <input id="turn-search" autocomplete="off" placeholder="Search messages, tools, prompts…">
        </header>
        <div id="turns-list" class="turn-list"></div>
      </section>
      <section class="trace-pane detail-pane" id="turn-detail">
        <div class="empty">Select a turn to inspect its context.</div>
      </section>
    </section>
  </main>
  ${renderTraceDataScript(data)}
  <script>${renderTraceDetailScript()}</script>
</body>
</html>`;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (character) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  })[character] ?? character);
}
