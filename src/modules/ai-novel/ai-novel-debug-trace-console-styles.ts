export const TRACE_CONSOLE_STYLES = `
:root {
  color-scheme: dark;
  --bg: #08111f;
  --panel: #101b2d;
  --panel-raised: #14233a;
  --panel-soft: #0d1829;
  --line: #263955;
  --line-strong: #365276;
  --text: #edf4ff;
  --muted: #91a4bf;
  --mint: #55d8b8;
  --blue: #74b8ff;
  --amber: #f2c56d;
  --violet: #c6a6ff;
  --red: #ff8f96;
  --green: #7de1a7;
}

* { box-sizing: border-box; }
html, body { min-height: 100%; }
body {
  margin: 0;
  background: var(--bg);
  color: var(--text);
  font: 13px/1.45 system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
}
button, input, select { font: inherit; }
button { cursor: pointer; }
a { color: inherit; }
.page { min-height: 100vh; padding: 22px; }
.page-header {
  display: flex;
  align-items: end;
  justify-content: space-between;
  gap: 18px;
  padding-bottom: 16px;
  border-bottom: 1px solid var(--line);
}
.eyebrow, .section-label, .message-role, .diff-kind {
  color: var(--muted);
  font-size: 10px;
  font-weight: 700;
  letter-spacing: .1em;
  text-transform: uppercase;
}
h1, h2, h3, p { margin: 0; }
h1 { font-size: 23px; letter-spacing: -.02em; }
h2 { font-size: 19px; }
.subtitle, .meta, .empty { color: var(--muted); }
.meta { font: 11px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace; }
.filters {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  padding: 14px 0;
}
.filter-field { display: grid; gap: 4px; min-width: 190px; }
.filter-field label { color: var(--muted); font-size: 11px; }
input, select {
  min-height: 36px;
  border: 1px solid var(--line);
  border-radius: 8px;
  background: var(--panel);
  color: var(--text);
  padding: 7px 10px;
  outline: none;
}
input:focus, select:focus { border-color: var(--mint); }
.filter-actions { display: flex; align-items: end; gap: 7px; }
.button {
  min-height: 36px;
  border: 1px solid var(--line-strong);
  border-radius: 8px;
  background: var(--panel-raised);
  color: var(--text);
  padding: 7px 12px;
}
.button:hover { border-color: var(--mint); }
.button.primary { border-color: #388b78; background: #133732; color: #dffff5; }
.session-list { display: grid; gap: 8px; }
.session-card {
  display: block;
  border: 1px solid var(--line);
  border-radius: 10px;
  background: var(--panel);
  padding: 13px;
  text-decoration: none;
}
.session-card:hover, .session-card.active { border-color: var(--mint); background: #112b2e; }
.session-top, .session-meta, .detail-toolbar, .request-summary, .turn-heading {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}
.session-meta { justify-content: flex-start; flex-wrap: wrap; margin-top: 7px; }
.pill, .status { border-radius: 999px; padding: 2px 7px; font-size: 10px; }
.pill { background: #1a2b42; color: var(--blue); }
.status { background: #1e2d41; color: var(--muted); }
.status.status-icon {
  display: inline-grid;
  width: 16px;
  height: 16px;
  padding: 0;
  place-items: center;
  border: 1px solid currentColor;
  border-radius: 50%;
  font-size: 11px;
  font-weight: 800;
  line-height: 1;
  vertical-align: middle;
  cursor: help;
  flex: 0 0 16px;
  margin-inline-start: 4px;
  text-decoration: none;
}
.status.completed { color: var(--green); }
.status.running { color: var(--amber); }
.status.failed, .status.cancelled { color: var(--red); }
.empty { border: 1px dashed var(--line); border-radius: 10px; padding: 28px; text-align: center; }

.trace-layout {
  display: grid;
  grid-template-columns: 250px 300px minmax(0, 1fr);
  min-height: calc(100vh - 44px);
  overflow: hidden;
  border: 1px solid var(--line);
  border-radius: 12px;
  background: var(--panel-soft);
}
.trace-pane { min-width: 0; padding: 12px; }
.trace-pane + .trace-pane { border-left: 1px solid var(--line); }
.trace-pane.sessions-pane, .trace-pane.turns-pane { background: #0c1728; }
.sessions-pane, .turns-pane { overflow: auto; }
.pane-header { padding-bottom: 10px; border-bottom: 1px solid var(--line); }
.pane-header h2 { margin-top: 3px; font-size: 16px; }
.pane-header input { width: 100%; min-width: 0; margin-top: 9px; }
.pane-list { display: grid; gap: 4px; padding-top: 9px; }
.pane-item {
  width: 100%;
  border: 1px solid transparent;
  border-radius: 8px;
  background: transparent;
  color: #bdcbe0;
  padding: 7px 8px;
  text-align: left;
}
.pane-item:hover { background: var(--panel-raised); }
.pane-item.active { border-color: #37796d; background: #15302f; color: #f0fffb; }
.pane-item strong, .pane-item small { display: block; }
.pane-item small {
  display: flex;
  align-items: center;
  min-height: 20px;
  margin-top: 1px;
  color: var(--muted);
  line-height: 20px;
  white-space: nowrap;
}
.turn-heading { align-items: start; padding-bottom: 14px; border-bottom: 1px solid var(--line); }
.turn-heading .turn-meta { display: grid; gap: 4px; text-align: right; }
.turn-list { display: grid; gap: 4px; padding-top: 9px; }
.turn-card { border: 0; border-left: 3px solid #5362ff; border-bottom: 1px solid var(--line); border-radius: 0; background: transparent; overflow: hidden; }
.turn-card.selected { border-color: #3a8b78; box-shadow: 0 0 0 1px #1c4f47 inset; }
.turn-card.selected { border-left-color: #6675ff; box-shadow: none; }
.turn-button { width: 100%; border: 0; background: transparent; color: inherit; padding: 8px 9px 9px; text-align: left; }
.turn-button:hover { background: #14243b; }
.turn-card.selected .turn-button { background: #15302f; }
.turn-title { display: flex; align-items: center; justify-content: space-between; gap: 6px; font-weight: 700; }
.turn-user { margin-top: 3px; color: #b6c6dc; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-size: 12px; }
.turn-summary { display: flex; flex-wrap: wrap; gap: 5px; margin-top: 5px; }
.turn-facts { display: flex; flex-wrap: wrap; align-items: center; gap: 7px; margin-top: 3px; color: var(--muted); font: 10px ui-monospace, SFMono-Regular, Menlo, monospace; }
.turn-fact.tokens { color: var(--mint); }
.turn-fact.duration { color: var(--amber); }
.turn-tools { display: flex; flex-wrap: wrap; gap: 3px; margin-top: 4px; }
.detail-pane { overflow: auto; }
.detail-toolbar { align-items: start; padding-bottom: 14px; border-bottom: 1px solid var(--line); }
.detail-toolbar h2 { margin-top: 4px; }
.toolbar-actions { display: flex; flex-wrap: wrap; justify-content: flex-end; gap: 7px; }
.detail-section { margin-top: 10px; border: 1px solid var(--line); border-radius: 8px; background: var(--panel); overflow: hidden; }
.section-header { padding: 9px 11px; background: var(--panel-raised); border-bottom: 1px solid var(--line); }
.section-body { padding: 9px; }
.diff-legend { display: flex; gap: 8px; margin-top: 5px; }
.diff-legend span { border-radius: 4px; padding: 1px 5px; font: 10px ui-monospace, SFMono-Regular, Menlo, monospace; }
.diff-legend .added { background: rgba(61, 177, 112, .18); color: #caffdb; }
.diff-legend .removed { background: rgba(220, 80, 90, .18); color: #ffd0d4; }
.diff {
  overflow: auto;
  max-height: 38vh;
  margin: 0;
  padding: 9px 0;
  background: #0a1424;
  font: 11px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace;
}
.diff-line { display: block; min-width: max-content; padding: 1px 12px; white-space: pre; }
.diff-line.same { color: #a9b8cb; }
.diff-line.added { background: rgba(61, 177, 112, .18); color: #caffdb; }
.diff-line.removed { background: rgba(220, 80, 90, .18); color: #ffd0d4; }
.diff-line.meta { color: var(--violet); font-style: italic; }
.message-list { display: grid; gap: 5px; }
.message {
  border-left: 3px solid var(--blue);
  border-radius: 0 8px 8px 0;
  background: #0b1627;
  padding: 7px 9px;
}
.message.assistant { border-color: var(--amber); }
.message.tool { border-color: var(--mint); }
.message.system { border-color: var(--violet); }
.message.user { border-color: var(--blue); }
.message-role { display: flex; align-items: center; min-height: 18px; margin-bottom: 3px; }
.role-icon {
  display: inline-grid;
  width: 15px;
  height: 15px;
  place-items: center;
  border-radius: 50%;
  background: #1a2b42;
  color: var(--blue);
  font-size: 9px;
  font-weight: 800;
  cursor: help;
}
.message.assistant .role-icon { background: #3d321d; color: var(--amber); }
.message.tool .role-icon { background: #163a35; color: var(--mint); }
.message.system .role-icon { background: #302444; color: var(--violet); }
.message-content { margin: 0; white-space: pre-wrap; overflow-wrap: anywhere; font: 11px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace; }
.request-list { display: grid; gap: 4px; }
.request {
  border: 1px solid var(--line);
  border-radius: 8px;
  background: #0d1829;
  overflow: hidden;
}
.request[open] { border-color: #396e72; }
.request-summary { padding: 8px 9px; list-style: none; cursor: pointer; }
.request-summary::-webkit-details-marker { display: none; }
.request-summary:hover { background: var(--panel-raised); }
.request-body { padding: 0 9px 9px; }
.request-body .message-list { margin-top: 9px; }
pre.json { overflow: auto; max-height: 34vh; margin: 0; padding: 10px; border-radius: 7px; background: #091321; color: #c9d7ea; font: 11px/1.55 ui-monospace, SFMono-Regular, Menlo, monospace; }
.json-key { color: #60a5fa !important; font-weight: 700; }
.json-string { color: #86efac !important; }
.json-number { color: #fbbf24 !important; }
.json-bool { color: #c084fc !important; }
.json-null { color: #94a3b8 !important; }
details.raw-json { margin-top: 9px; }
details.raw-json > summary { color: var(--blue); cursor: pointer; }
.hidden { display: none !important; }
@media (max-width: 1100px) {
  .trace-layout { grid-template-columns: 220px 260px minmax(0, 1fr); }
}
@media (max-width: 820px) {
  .page { padding: 12px; }
  .page-header, .detail-toolbar { display: block; }
  .toolbar-actions { justify-content: flex-start; margin-top: 10px; }
  .trace-layout { grid-template-columns: 1fr; overflow: visible; }
  .trace-pane + .trace-pane { border-left: 0; border-top: 1px solid var(--line); }
  .sessions-pane, .turns-pane, .detail-pane { max-height: none; overflow: visible; }
}
`;
