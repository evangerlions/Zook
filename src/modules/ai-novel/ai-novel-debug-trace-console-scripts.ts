export function renderTraceSessionListScript(): string {
  return String.raw`(() => {
  const root = '/api/v1/ai_novel/debug/traces';
  const form = document.getElementById('trace-filters');
  const list = document.getElementById('list');
  const count = document.getElementById('count');
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
  const status = (value) => {
    const labels = {completed: '✓', running: '◌', failed: '!', cancelled: '×'};
    const label = String(value ?? 'unknown');
    return '<span class="status status-icon ' + esc(label) + '" title="' + esc(label) +
      '" aria-label="' + esc(label) + '">' + (labels[label] || '?') + '</span>';
  };
  const query = () => new URLSearchParams(new FormData(form));
  const load = async () => {
    list.innerHTML = '<div class="empty">Loading sessions…</div>';
    const response = await fetch(root + '/data?' + query());
    if (!response.ok) {
      list.innerHTML = '<div class="empty">Trace Console is unavailable.</div>';
      return;
    }
    const body = await response.json();
    const items = body.data?.items ?? [];
    count.textContent = items.length + ' sessions';
    list.innerHTML = items.length ? items.map(sessionCard).join('') :
      '<div class="empty">No sessions match these filters.</div>';
  };
  const sessionCard = (item) => {
    const href = root + '/' + encodeURIComponent(item.sessionId) +
      '?kind=' + encodeURIComponent(item.kind);
    return '<a class="session-card" href="' + href + '">' +
      '<div class="session-top"><strong>' + esc(item.title || item.sessionId) +
      '</strong>' + status(item.status) + '</div>' +
      '<div class="session-meta"><span class="pill">' + esc(item.kind) + '</span>' +
      '<span class="meta">UID ' + esc(item.uid || '—') + '</span>' +
      '<span class="meta">CID ' + esc(item.sessionId) + '</span></div>' +
      '<div class="meta">' + esc(item.captureCount || 0) + ' snapshots · ' +
      esc(item.updatedAt) + '</div></a>';
  };
  form?.addEventListener('submit', (event) => { event.preventDefault(); load(); });
  document.getElementById('clear-filters')?.addEventListener('click', () => {
    form.reset();
    load();
  });
  load();
})();`;
}

export function renderTraceDetailScript(): string {
  return String.raw`(() => {
  const data = JSON.parse(document.getElementById('trace-data').textContent);
  const root = '/api/v1/ai_novel/debug/traces';
  const manifest = data.session.manifest;
  const sessions = data.sessions ?? [];
  const turns = data.viewModel.turns ?? [];
  let turnIndex = Math.max(0, turns.length - 1);
  const esc = (value) => String(value ?? '').replace(/[&<>"']/g, (char) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[char]));
  const json = (value) => {
    return highlightJsonText(JSON.stringify(value ?? {}, null, 2));
  };
  const highlightJsonText = (value) => {
    const text = esc(value);
    return text.replace(
      /(&quot;.*?&quot;)(\s*:)?|\b(-?\d+(?:\.\d+)?)\b|\b(true|false)\b|\bnull\b/g,
      (match, quoted, colon, number, boolean) => {
        if (quoted) return '<span class="json-' + (colon ? 'key' : 'string') + '">' + match + '</span>';
        if (number) return '<span class="json-number">' + match + '</span>';
        if (boolean) return '<span class="json-bool">' + match + '</span>';
        return '<span class="json-null">null</span>';
      },
    );
  };
  const content = (value) => typeof value === 'string' ? value : JSON.stringify(value ?? {}, null, 2);
  const roleClass = (role) => ['user', 'assistant', 'tool', 'system'].includes(role) ? role : '';
  const roleIcon = (role) => {
    const label = String(role || 'message');
    const icons = {user: '●', assistant: '✦', tool: '⚙', system: '◆'};
    return '<span class="role-icon ' + roleClass(label) + '" title="' + esc(label) +
      '" aria-label="' + esc(label) + '">' + (icons[label] || '·') + '</span>';
  };
  const status = (value) => {
    const labels = {completed: '✓', running: '◌', failed: '!', cancelled: '×'};
    const label = String(value ?? 'unknown');
    return '<span class="status status-icon ' + esc(label) + '" title="' + esc(label) +
      '" aria-label="' + esc(label) + '">' + (labels[label] || '?') + '</span>';
  };
  const formatTokens = (value) => value == null ? '—' : Number(value).toLocaleString() + ' tok';
  const formatDuration = (value) => value == null ? '—' : (Number(value) / 1000).toFixed(1) + 's';
  const toolChips = (names) => (names ?? []).map((name) => '<span class="pill">' + esc(name) + '</span>').join('');
  const facts = (item) => [
    item.tokenCount != null ? '<span class="turn-fact tokens">' + formatTokens(item.tokenCount) + '</span>' : '',
    item.durationMs != null ? '<span class="turn-fact duration">' + formatDuration(item.durationMs) + '</span>' : '',
    item.model ? '<span>' + esc(item.model) + '</span>' : '',
    item.transport ? '<span>' + esc(item.transport) + '</span>' : '',
  ].filter(Boolean).join('');
  const sessionHref = (item) => root + '/' + encodeURIComponent(item.sessionId) + '?kind=' + encodeURIComponent(item.kind);
  const renderSessions = (items) => {
    const host = document.getElementById('sessions-list');
    document.getElementById('session-count').textContent = items.length;
    host.innerHTML = items.length ? items.map((item) => '<a class="pane-item ' +
      (item.sessionId === manifest.sessionId && item.kind === manifest.kind ? 'active' : '') +
      '" href="' + sessionHref(item) + '"><strong>' + esc(item.title || item.sessionId) +
      '</strong><small>' + esc(item.kind) + ' · ' + status(item.status) + '</small>' +
      '<small>UID ' + esc(item.uid || '—') + ' · CID ' + esc(item.sessionId) + '</small></a>').join('') :
      '<div class="empty">No sessions match these filters.</div>';
  };
  const messageHtml = (message) => '<article class="message ' + roleClass(message.role) + '">' +
    '<div class="message-role">' + roleIcon(message.role) + '</div>' +
    '<pre class="message-content">' + esc(content(message.content)) + '</pre></article>';
  const eventHtml = (event) => {
    const type = String(event.type ?? 'event');
    if (!type.includes('tool_call')) return '';
    const tool = event.toolCallName || event.toolCall?.name || event.toolName || type;
    return '<span class="pill">' + esc(tool) + '</span>';
  };
  const requestHtml = (request, index, latestIndex) => {
    const toolEvents = request.events.map(eventHtml).filter(Boolean).join('');
    return '<details class="request" ' + (index === latestIndex ? 'open' : '') + '>' +
      '<summary class="request-summary"><span><strong>LLM request ' + (index + 1) +
      '</strong><small class="meta">' + esc(request.sceneKey || 'model call') + ' · ' +
      esc(request.capturedAt) + '</small></span><span>' + status(request.status) + '</span></summary>' +
      '<div class="request-body">' + (facts(request) ? '<div class="turn-facts">' + facts(request) + '</div>' : '') +
      (toolEvents ? '<div class="turn-tools">' + toolEvents + '</div>' : '') +
      (request.messages.length ? '<div class="message-list">' + request.messages.map(messageHtml).join('') + '</div>' : '') +
      '<details class="raw-json"><summary>View raw JSON</summary><pre class="json">' + json(request.raw) + '</pre></details>' +
      '</div></details>';
  };
  const turnMatches = (turn, query) => {
    if (!query) return true;
    const haystack = [
      turn.userMessage?.content,
      turn.model,
      turn.transport,
      ...(turn.toolNames ?? []),
      ...turn.messages.map((message) => message.content),
      ...turn.requests.map((request) => request.sceneKey),
    ].map((value) => String(value ?? '')).join('\n').toLowerCase();
    return haystack.includes(query.toLowerCase());
  };
  const renderTurnList = () => {
    const host = document.getElementById('turns-list');
    const query = document.getElementById('turn-search')?.value.trim() ?? '';
    const visible = turns.map((turn, index) => ({turn, index}))
      .filter(({turn}) => turnMatches(turn, query));
    host.innerHTML = visible.length ? visible.map(({turn, index}) => {
      const user = turn.userMessage ? content(turn.userMessage.content) : 'No user message found';
      return '<article class="turn-card ' + (index === turnIndex ? 'selected' : '') + '">' +
        '<button class="turn-button" data-turn="' + index + '"><span class="turn-title">Turn ' +
        (index + 1) + '<span>' + status(turn.status) + '</span></span><span class="turn-user">' +
        esc(user) + '</span>' + (facts(turn) ? '<span class="turn-facts">' + facts(turn) + '</span>' : '') +
        (turn.toolNames?.length ? '<span class="turn-tools">' + toolChips(turn.toolNames) + '</span>' : '') +
        '<span class="turn-summary\"><span class=\"pill\">' + turn.requests.length +
        ' requests</span><span class="meta">' + esc(turn.capturedAt) + '</span></span></button></article>';
    }).join('') : '<div class="empty">No turns found in this session.</div>';
    host.querySelectorAll('[data-turn]').forEach((button) => button.addEventListener('click', () => {
      turnIndex = Number(button.dataset.turn);
      render();
    }));
  };
  const renderDetail = () => {
    const host = document.getElementById('turn-detail');
    const turn = turns[turnIndex];
    if (!turn) {
      host.innerHTML = '<div class="empty">Select a turn to inspect its context.</div>';
      return;
    }
    const user = turn.userMessage ? content(turn.userMessage.content) : 'No user message found';
    host.innerHTML = '<div class="detail-toolbar"><div><div class="eyebrow">Turn ' +
      (turnIndex + 1) + '</div><h2>' + esc(user.slice(0, 120)) + '</h2><div class="meta">' +
      esc(turn.id) + ' · ' + esc(turn.capturedAt) + '</div></div><div class="toolbar-actions">' +
      status(turn.status) + '<button class="button" id="raw-turn">View raw JSON</button></div></div>' +
      '<section class="detail-section"><div class="section-header"><strong>Messages in current context</strong><div class="meta">' +
      turn.messages.length + ' messages</div></div><div class="section-body"><div class="message-list">' +
      turn.messages.map(messageHtml).join('') + '</div></div></section>' +
      '<section class="detail-section"><div class="section-header"><strong>All model requests in this turn</strong><div class="meta">Latest request expanded; older calls are collapsible</div></div><div class="section-body"><div class="request-list">' +
      turn.requests.map((request, index) => requestHtml(request, index, turn.requests.length - 1)).join('') + '</div></div></section>' +
      '<section class="detail-section"><div class="section-header"><strong>Context diff</strong><div class="meta">Current turn compared with the previous turn</div><div class="diff-legend"><span class="added" title="added" aria-label="added">+</span><span class="removed" title="removed" aria-label="removed">−</span></div></div><pre class="diff">' +
      turn.contextDiff.map((line) => '<span class="diff-line ' + esc(line.kind) + '">' +
        (line.kind === 'added' ? '+ ' : line.kind === 'removed' ? '- ' : '  ') + highlightJsonText(line.text) + '</span>').join('') +
      '</pre></section>';
    document.getElementById('raw-turn')?.addEventListener('click', () => {
      const existing = host.querySelector('.turn-raw-json');
      if (existing) { existing.remove(); return; }
      const details = document.createElement('details');
      details.className = 'raw-json turn-raw-json';
      details.open = true;
      details.innerHTML = '<summary>Full turn JSON</summary><pre class="json">' + json(turn.raw) + '</pre>';
      host.appendChild(details);
    });
  };
  const render = () => { renderTurnList(); renderDetail(); };
  renderSessions(sessions);
  render();
  document.getElementById('turn-search')?.addEventListener('input', renderTurnList);
  document.getElementById('trace-filters')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const query = new URLSearchParams(new FormData(event.currentTarget));
    const response = await fetch(root + '/data?' + query);
    if (!response.ok) return;
    const body = await response.json();
    renderSessions(body.data?.items ?? []);
  });
  document.getElementById('clear-filters')?.addEventListener('click', () => {
    document.getElementById('trace-filters').reset();
    renderSessions(sessions);
  });
})();`;
}

export function renderTraceDataScript(data: Record<string, unknown>): string {
  const embedded = JSON.stringify(data)
    .replaceAll("</", "<\\/")
    .replaceAll("<!--", "<\\!--");
  return `<script id="trace-data" type="application/json">${embedded}</script>`;
}
