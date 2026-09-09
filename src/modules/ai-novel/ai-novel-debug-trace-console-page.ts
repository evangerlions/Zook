import { TRACE_CONSOLE_STYLES } from "./ai-novel-debug-trace-console-styles.ts";
import { renderTraceSessionListScript } from "./ai-novel-debug-trace-console-scripts.ts";

export function renderTraceSessionListPage(): string {
  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>AINovel Trace Console</title>
  <style>${TRACE_CONSOLE_STYLES}</style>
</head>
<body>
  <main class="page">
    <header class="page-header">
      <div>
        <div class="eyebrow">Local and development diagnostics only</div>
        <h1>AINovel Trace Console</h1>
        <p class="subtitle">Sessions are ordered by their latest activity.</p>
      </div>
      <div id="count" class="subtitle"></div>
    </header>
    ${renderTraceFilters()}
    <section id="list" class="session-list" aria-live="polite"></section>
  </main>
  <script>${renderTraceSessionListScript()}</script>
</body>
</html>`;
}
export function renderTraceFilters(): string {
  return `<form id="trace-filters" class="filters">
  <div class="filter-field">
    <label for="uid">UID</label>
    <input id="uid" name="uid" autocomplete="off" placeholder="User ID">
  </div>
  <div class="filter-field">
    <label for="cid">CID</label>
    <input id="cid" name="cid" autocomplete="off" placeholder="Conversation / session ID">
  </div>
  <div class="filter-field">
    <label for="kind">Kind</label>
    <select id="kind" name="kind">
      <option value="">All kinds</option>
      <option value="kickoff">kickoff</option>
      <option value="import_book">import_book</option>
      <option value="imported_kickoff">imported_kickoff</option>
      <option value="writing">writing</option>
      <option value="history_qa">history_qa</option>
      <option value="advance_chapter">advance_chapter</option>
    </select>
  </div>
  <div class="filter-field">
    <label for="status">Status</label>
    <select id="status" name="status">
      <option value="">All statuses</option>
      <option value="running">running</option>
      <option value="completed">completed</option>
      <option value="failed">failed</option>
      <option value="cancelled">cancelled</option>
    </select>
  </div>
  <details class="filter-field">
    <summary>More filters</summary>
    <div class="filters">
      <input id="query" name="query" autocomplete="off" placeholder="Search title, book or chapter">
      <input id="bookId" name="bookId" autocomplete="off" placeholder="Book ID">
      <input id="chapterId" name="chapterId" autocomplete="off" placeholder="Chapter ID">
    </div>
  </details>
  <div class="filter-actions">
    <button class="button primary" type="submit">Filter</button>
    <button class="button" id="clear-filters" type="button">Clear</button>
  </div>
</form>`;
}
