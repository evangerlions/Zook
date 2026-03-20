const runtimeConfig = window.__ADMIN_RUNTIME_CONFIG__ ?? {};
const STORAGE_KEYS = {
  selectedAppId: "zook.admin.selectedAppId",
};

const appRoot = document.getElementById("app");
const CONFIG_ROUTE = "/config";

const state = {
  busy: false,
  loadingBootstrap: true,
  loadingConfig: false,
  notice: null,
  adminUser: "",
  apps: [],
  selectedAppId: loadSelectedAppId(),
  configDocument: null,
  editorValue: "",
  savedValue: "",
  editorError: "",
};

window.addEventListener("popstate", () => {
  render().catch(handleUnexpectedError);
});

appRoot.addEventListener("click", (event) => {
  const target = event.target.closest("[data-link], [data-action]");
  if (!target) {
    return;
  }

  if (target.dataset.link) {
    event.preventDefault();
    navigate(target.dataset.link);
    return;
  }

  if (target.dataset.action) {
    event.preventDefault();
    handleAction(target.dataset.action).catch(handleUnexpectedError);
  }
});

appRoot.addEventListener("submit", (event) => {
  const form = event.target;
  if (!(form instanceof HTMLFormElement)) {
    return;
  }

  event.preventDefault();
  handleFormSubmit(form).catch(handleUnexpectedError);
});

appRoot.addEventListener("change", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLSelectElement)) {
    return;
  }

  if (target.name === "selectedAppId") {
    handleAppSwitch(target.value).catch(handleUnexpectedError);
  }
});

appRoot.addEventListener("input", (event) => {
  const target = event.target;
  if (!(target instanceof HTMLTextAreaElement)) {
    return;
  }

  if (target.name === "configJson") {
    state.editorValue = target.value;
    state.editorError = "";
    syncDirtyState();
  }
});

boot().catch(handleUnexpectedError);

async function boot() {
  await render();
  await loadBootstrap();
  await loadSelectedAppConfig();
  await render();
}

function loadSelectedAppId() {
  return localStorage.getItem(STORAGE_KEYS.selectedAppId) ?? "";
}

function saveSelectedAppId(appId) {
  state.selectedAppId = appId;
  localStorage.setItem(STORAGE_KEYS.selectedAppId, appId);
}

function currentPath() {
  return window.location.pathname.replace(/\/+$/, "") || "/";
}

function ensureConfigRoute() {
  const path = currentPath();
  if (path === CONFIG_ROUTE) {
    return CONFIG_ROUTE;
  }

  window.history.replaceState({}, "", CONFIG_ROUTE);
  return CONFIG_ROUTE;
}

function navigate(path) {
  if (currentPath() === path) {
    render().catch(handleUnexpectedError);
    return;
  }

  window.history.pushState({}, "", path);
  render().catch(handleUnexpectedError);
}

function setNotice(tone, text) {
  state.notice = {
    tone,
    text,
  };
}

function clearNotice() {
  state.notice = null;
}

function handleUnexpectedError(error) {
  console.error(error);
  setNotice("error", formatError(error));
  render().catch(console.error);
}

function selectedApp() {
  return state.apps.find((item) => item.appId === state.selectedAppId) ?? null;
}

function hasUnsavedChanges() {
  return state.editorValue !== state.savedValue;
}

function syncDirtyState() {
  const editor = appRoot.querySelector('textarea[name="configJson"]');
  if (!(editor instanceof HTMLTextAreaElement)) {
    return;
  }

  editor.dataset.dirty = hasUnsavedChanges() ? "true" : "false";
}

async function render() {
  const path = ensureConfigRoute();
  syncDocumentTitle(path);
  appRoot.innerHTML = renderConsole();
  syncDirtyState();
}

function renderConsole() {
  return `
    <div class="admin-shell">
      <aside class="sidebar">
        <div class="sidebar-brand">
          <div class="brand-mark" aria-hidden="true">YW</div>
          <div class="stack-tight">
            <p class="eyebrow">Test Logo</p>
            <h1 class="brand-title">${escapeHtml(runtimeConfig.brandName || "Zook Admin")}</h1>
            <p class="muted-copy">Workspace-first config delivery console</p>
          </div>
        </div>

        <section class="sidebar-section">
          <p class="section-label">Workspace</p>
          <div class="workspace-card">
            <p class="workspace-name">${escapeHtml(selectedApp()?.appName || "未选择 App")}</p>
            <p class="workspace-code">${escapeHtml(selectedApp()?.appCode || "pending")}</p>
            <span class="workspace-status" data-tone="${escapeHtml(selectedApp()?.status === "ACTIVE" ? "success" : "warning")}">
              ${escapeHtml(selectedApp()?.status || "LOADING")}
            </span>
          </div>
        </section>

        <nav class="sidebar-nav" aria-label="工作区导航">
          <a class="nav-item" data-link="/config" data-active="true" href="/config" aria-current="page">
            <span class="nav-item-title">Config</span>
            <span class="nav-item-copy">配置下发</span>
          </a>
        </nav>

        <section class="sidebar-section sidebar-meta">
          <p class="section-label">Config Key</p>
          <code>${escapeHtml(state.configDocument?.configKey || "admin.delivery_config")}</code>
          <p class="muted-copy">只保留一个配置入口，直接维护服务端 JSON 文档。</p>
        </section>
      </aside>

      <div class="main-shell">
        <header class="topbar">
          <div class="topbar-left">
            <div>
              <p class="eyebrow">Admin Console</p>
              <h2 class="topbar-title">Configuration Delivery</h2>
            </div>
          </div>

          <div class="topbar-center">
            <label class="select-field">
              <span>当前 App</span>
              <select name="selectedAppId" ${state.loadingBootstrap || state.apps.length === 0 ? "disabled" : ""}>
                ${renderAppOptions()}
              </select>
            </label>
          </div>

          <div class="topbar-right">
            <nav class="topbar-links" aria-label="外部工具">
              <a href="${escapeHtml(runtimeConfig.analyticsUrl || "https://analytics.youwoai.net")}" target="_blank" rel="noreferrer">Analytics</a>
              <a href="${escapeHtml(runtimeConfig.logsUrl || "https://log.youwoai.net")}" target="_blank" rel="noreferrer">Logs</a>
            </nav>
            <div class="user-chip">
              <span class="user-chip-label">Admin</span>
              <strong>${escapeHtml(state.adminUser || "loading")}</strong>
            </div>
          </div>
        </header>

        <main id="main-content" class="content-shell">
          ${renderNotice()}
          ${renderContent()}
        </main>
      </div>
    </div>
  `;
}

function renderAppOptions() {
  if (state.loadingBootstrap) {
    return '<option value="">加载中...</option>';
  }

  if (state.apps.length === 0) {
    return '<option value="">暂无可管理 App</option>';
  }

  return state.apps
    .map(
      (app) => `
        <option value="${escapeHtml(app.appId)}" ${app.appId === state.selectedAppId ? "selected" : ""}>
          ${escapeHtml(`${app.appName} · ${app.appCode}`)}
        </option>
      `,
    )
    .join("");
}

function renderNotice() {
  if (!state.notice) {
    return "";
  }

  const tone = state.notice.tone || "info";
  return `
    <section class="notice" data-tone="${escapeHtml(tone)}" role="${tone === "error" ? "alert" : "status"}" aria-live="${
      tone === "error" ? "assertive" : "polite"
    }">
      <span class="notice-label">${escapeHtml(tone === "error" ? "Error" : "Notice")}</span>
      <p>${escapeHtml(state.notice.text)}</p>
    </section>
  `;
}

function renderContent() {
  if (state.loadingBootstrap) {
    return `
      <section class="page-shell page-shell-loading">
        <div class="page-hero">
          <div class="skeleton skeleton-title"></div>
          <div class="skeleton skeleton-copy"></div>
        </div>
        <div class="editor-layout">
          <section class="panel panel-main"><div class="skeleton skeleton-editor"></div></section>
          <section class="panel panel-side"><div class="skeleton skeleton-card"></div></section>
        </div>
      </section>
    `;
  }

  if (state.apps.length === 0) {
    return `
      <section class="empty-state">
        <h3>当前没有可管理的 App</h3>
        <p>请先在后端初始化 app 数据，再进入配置下发后台。</p>
      </section>
    `;
  }

  const app = selectedApp();
  const updatedAt = state.configDocument?.updatedAt ? formatTimestamp(state.configDocument.updatedAt) : "尚未保存过";

  return `
    <section class="page-shell">
      <header class="page-hero">
        <div class="stack-tight">
          <p class="eyebrow">Config Center</p>
          <h3 class="page-title">${escapeHtml(app?.appName || "当前 App")} 配置下发</h3>
          <p class="page-copy">
            这里就是服务端配置的唯一后台入口。选择一个 App，直接编辑 JSON 文档并保存，页面会在提交前做基础格式校验。
          </p>
        </div>
        <div class="hero-chips">
          <span class="meta-chip">App · ${escapeHtml(app?.appCode || "unknown")}</span>
          <span class="meta-chip">Updated · ${escapeHtml(updatedAt)}</span>
          <span class="meta-chip">${hasUnsavedChanges() ? "Unsaved changes" : "Saved"}</span>
        </div>
      </header>

      <div class="editor-layout">
        <section class="panel panel-main">
          <div class="panel-header">
            <div class="stack-tight">
              <h4 class="panel-title">JSON Editor</h4>
              <p class="muted-copy">根节点要求是 JSON object。保存时会自动格式化为 2 空格缩进。</p>
            </div>
            <div class="panel-actions">
              <button class="button button-secondary" type="button" data-action="reload-config" ${state.loadingConfig ? "disabled" : ""}>重新读取</button>
              <button class="button button-secondary" type="button" data-action="validate-json" ${state.loadingConfig ? "disabled" : ""}>校验格式</button>
              <button class="button button-secondary" type="button" data-action="format-json" ${state.loadingConfig ? "disabled" : ""}>格式化</button>
            </div>
          </div>

          <form class="editor-form" data-form="save-config">
            <label class="editor-label" for="config-json">配置内容</label>
            <textarea
              id="config-json"
              name="configJson"
              class="json-editor"
              spellcheck="false"
              placeholder='{\n  "featureFlags": {},\n  "settings": {}\n}'
              ${state.loadingConfig ? "disabled" : ""}
            >${escapeHtml(state.editorValue)}</textarea>
            ${
              state.editorError
                ? `<p class="editor-error" role="alert">${escapeHtml(state.editorError)}</p>`
                : '<p class="editor-hint">建议先点“校验格式”或“格式化”，确认根节点是一个 JSON object 后再保存。</p>'
            }
            <div class="form-footer">
              <button class="button button-ghost" type="button" data-action="reset-config" ${!hasUnsavedChanges() || state.loadingConfig ? "disabled" : ""}>恢复已保存版本</button>
              <button class="button button-primary" type="submit" ${state.busy || state.loadingConfig ? "disabled" : ""}>
                ${state.busy ? "保存中..." : "保存配置"}
              </button>
            </div>
          </form>
        </section>

        <section class="panel panel-side">
          <div class="stack">
            <div class="stack-tight">
              <h4 class="panel-title">Workspace Notes</h4>
              <p class="muted-copy">这是一个标准的配置后台，不展示心跳、指标和登录流程，只做配置下发。</p>
            </div>

            <div class="meta-list">
              ${renderMetaLine("当前 App", app?.appName || "未选择")}
              ${renderMetaLine("App Code", app?.appCode || "pending")}
              ${renderMetaLine("配置键", state.configDocument?.configKey || "admin.delivery_config")}
              ${renderMetaLine("登录用户", state.adminUser || "loading")}
            </div>

            <div class="callout">
              <h5>基础校验规则</h5>
              <ul>
                <li>必须是合法 JSON。</li>
                <li>根节点必须是 object，不能是数组或纯字符串。</li>
                <li>保存时会统一格式化，避免服务端存进一坨压缩字符串。</li>
              </ul>
            </div>

            <div class="callout">
              <h5>操作建议</h5>
              <ul>
                <li>切换 App 后会自动重新读取对应配置。</li>
                <li>先格式化再保存，可以减少无意义 diff。</li>
                <li>如果后面要加结构约束，再在这里接 schema 校验就行。</li>
              </ul>
            </div>
          </div>
        </section>
      </div>
    </section>
  `;
}

function renderMetaLine(label, value) {
  return `
    <div class="meta-line">
      <span>${escapeHtml(label)}</span>
      <strong>${escapeHtml(value)}</strong>
    </div>
  `;
}

async function handleAction(action) {
  if (action === "reload-config") {
    await loadSelectedAppConfig();
    setNotice("success", "已从服务端重新读取配置。");
    await render();
    return;
  }

  if (action === "validate-json") {
    const parsed = parseConfigText(state.editorValue);
    const topLevelCount = Object.keys(parsed).length;
    state.editorError = "";
    setNotice("success", `JSON 格式有效，当前有 ${topLevelCount} 个顶级字段。`);
    await render();
    return;
  }

  if (action === "format-json") {
    const parsed = parseConfigText(state.editorValue);
    state.editorValue = JSON.stringify(parsed, null, 2);
    state.editorError = "";
    setNotice("success", "配置已格式化。");
    await render();
    return;
  }

  if (action === "reset-config") {
    state.editorValue = state.savedValue;
    state.editorError = "";
    setNotice("info", "已恢复到最近一次保存的版本。");
    await render();
  }
}

async function handleFormSubmit(form) {
  if (form.dataset.form !== "save-config") {
    return;
  }

  if (!state.selectedAppId) {
    setNotice("error", "请先选择一个 App。");
    await render();
    return;
  }

  state.busy = true;
  state.editorError = "";
  clearNotice();
  await render();

  try {
    const parsed = parseConfigText(state.editorValue);
    const normalized = JSON.stringify(parsed, null, 2);
    const payload = await requestJson(`/api/v1/admin/apps/${encodeURIComponent(state.selectedAppId)}/config`, {
      method: "PUT",
      body: {
        rawJson: normalized,
      },
    });

    state.configDocument = payload.data;
    state.editorValue = payload.data.rawJson;
    state.savedValue = payload.data.rawJson;
    state.editorError = "";
    setNotice("success", "配置已保存到服务端。");
  } catch (error) {
    if (error && error.code === "ADMIN_CONFIG_INVALID_JSON") {
      state.editorError = error.message;
    }
    setNotice("error", formatError(error));
  } finally {
    state.busy = false;
  }

  await render();
}

async function handleAppSwitch(nextAppId) {
  if (!nextAppId || nextAppId === state.selectedAppId) {
    return;
  }

  saveSelectedAppId(nextAppId);
  clearNotice();
  await loadSelectedAppConfig();
  setNotice("success", `已切换到 ${selectedApp()?.appName || nextAppId}。`);
  await render();
}

async function loadBootstrap() {
  state.loadingBootstrap = true;
  clearNotice();

  try {
    const payload = await requestJson("/api/v1/admin/bootstrap");
    state.adminUser = payload.data.adminUser;
    state.apps = payload.data.apps ?? [];

    if (!state.apps.some((item) => item.appId === state.selectedAppId)) {
      const defaultApp = state.apps.find((item) => item.appId === runtimeConfig.defaultAppId);
      saveSelectedAppId(defaultApp?.appId || state.apps[0]?.appId || "");
    }
  } finally {
    state.loadingBootstrap = false;
  }
}

async function loadSelectedAppConfig() {
  if (!state.selectedAppId) {
    state.configDocument = null;
    state.editorValue = "";
    state.savedValue = "";
    state.loadingConfig = false;
    return;
  }

  state.loadingConfig = true;
  state.editorError = "";
  await render();

  try {
    const payload = await requestJson(`/api/v1/admin/apps/${encodeURIComponent(state.selectedAppId)}/config`);
    state.configDocument = payload.data;
    state.editorValue = payload.data.rawJson;
    state.savedValue = payload.data.rawJson;
  } finally {
    state.loadingConfig = false;
  }
}

function parseConfigText(rawText) {
  let parsed;

  try {
    parsed = JSON.parse(rawText);
  } catch {
    throw new Error("请输入合法的 JSON。");
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("配置根节点必须是一个 JSON object。");
  }

  return parsed;
}

async function requestJson(path, { method = "GET", body } = {}) {
  const headers = new Headers({
    Accept: "application/json",
  });

  if (body !== undefined) {
    headers.set("Content-Type", "application/json");
  }

  const response = await fetch(path, {
    method,
    headers,
    credentials: "include",
    body: body === undefined ? undefined : JSON.stringify(body),
  });

  const payload = await parseResponsePayload(response);

  if (!response.ok) {
    const error = new Error(payload?.message || `Request failed with status ${response.status}`);
    error.statusCode = response.status;
    error.code = payload?.code;
    throw error;
  }

  return payload;
}

async function parseResponsePayload(response) {
  const contentType = response.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    return response.json();
  }

  return {
    code: response.ok ? "OK" : "HTTP_ERROR",
    message: await response.text(),
    data: null,
    requestId: "admin_plain_text",
  };
}

function formatTimestamp(value) {
  if (!value) {
    return "—";
  }

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

function syncDocumentTitle(path) {
  const base = runtimeConfig.brandName || "Zook Admin";
  const label = path === CONFIG_ROUTE ? "配置下发" : "管理后台";
  document.title = `${label} | ${base}`;
}

function formatError(error) {
  if (!error) {
    return "发生了未知错误。";
  }

  if (error.code && error.message) {
    return `${error.code}: ${error.message}`;
  }

  if (error.message) {
    return error.message;
  }

  return String(error);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}
